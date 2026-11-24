import { parse } from "acorn";

// A finite, flow-insensitive value analysis of the Maniac JS host. No game code
// runs. Cells union writes across branches, callbacks and separate 3030 records.
// AST objects identify function/array/object allocations, including their fields.
const num = "#",
  text = "*",
  data = "data",
  opaque = "opaque",
  nil = "~";
const blocked = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "valueOf",
  "toString",
  "toJSON",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "then",
  "eval",
  "Function",
  "Proxy",
  "Reflect",
  "Symbol",
  "include",
]);
const methods = new Set(["forEach", "find", "map", "slice", "includes", "join", "push", "replace"]);
const pureHost = new Set([
  "gameFrame",
  "setNextNumberInput",
  "netplayTime",
  "netplayButtons",
  "netplayFade",
  "netplayWaitingForInput",
  "netplayContinuePicture",
  "setNetplayProjection",
  "netplaySample",
  "netplayUpcoming",
  "netplayPosition",
  "netplayProject",
]);
const canvasMethods = new Set(["fill", "textWidth", "text", "capture", "restore", "peerLatency"]);
const math = new Set([
  "abs",
  "min",
  "max",
  "trunc",
  "floor",
  "ceil",
  "sin",
  "cos",
  "atan2",
  "random",
  "imul",
  "clz32",
  "sign",
  "sqrt",
]);
const inherited = new Set(
  [Object, Array, Function, String, Number, Boolean, RegExp].flatMap((ctor) =>
    Object.getOwnPropertyNames(ctor.prototype),
  ),
);

const isFunction = (n) =>
  n?.type === "ArrowFunctionExpression" ||
  n?.type === "FunctionDeclaration" ||
  n?.type === "FunctionExpression";
const stringValue = (x) => typeof x === "string" && (x[0] === "=" || x[0] === "%");
const native = (name) => "@" + name;

export function analyzeManiacScripts(scripts) {
  let writesStrings = false;
  let source = "",
    work = 0,
    changed = false;
  const effects = new Set(),
    scopes = new Map(),
    fields = new Map(),
    returns = new Map();
  const globals = new Map(),
    owners = new Map(),
    functions = [],
    programs = [];
  const fail = (reason) => {
    throw new Error(reason);
  };
  const cell = (map, key) => {
    if (!map.has(key)) map.set(key, new Set());
    return map.get(key);
  };
  const put = (dst, values) => {
    for (let v of values) {
      if (typeof v === "number" && dst.has(num)) continue;
      if (typeof v === "number" && dst.size > 48) v = num;
      if (stringValue(v) && dst.has(text)) continue;
      if (stringValue(v) && (v.length > 2048 || dst.size > 96)) v = text;
      if (!dst.has(v)) {
        dst.add(v);
        changed = true;
      }
      if (dst.size > 256) fail("值集合超出分析范围");
    }
  };
  const field = (obj, key) => {
    if (!fields.has(obj)) fields.set(obj, new Map());
    return cell(fields.get(obj), key);
  };
  const check = (key) => {
    if (blocked.has(key)) fail("间接执行或反射属性 " + key);
  };
  function binding(scope, key) {
    check(key);
    for (let s = scope; s; s = s.parent) if (s.vars.has(key)) return s.vars.get(key);
    return cell(globals, key);
  }
  function declare(pattern, vars) {
    if (pattern.type === "Identifier") {
      check(pattern.name);
      cell(vars, pattern.name);
    } else if (pattern.type === "AssignmentPattern") declare(pattern.left, vars);
    else if (pattern.type === "ArrayPattern") pattern.elements.forEach((x) => x && declare(x, vars));
    else fail("未支持的绑定 " + pattern.type);
  }
  function prepare(n, scope) {
    if (++work > 80000) fail("脚本语法树过大");
    if (isFunction(n)) {
      if (n.async || n.generator) fail("异步或生成器函数");
      if (n.id && n.type === "FunctionDeclaration") {
        declare(n.id, scope.vars);
        put(binding(scope, n.id.name), [n]);
      }
      functions.push(n);
      owners.set(n, source);
      scope = { parent: scope, vars: new Map() };
      if (n.id && n.type === "FunctionExpression") {
        declare(n.id, scope.vars);
        put(binding(scope, n.id.name), [n]);
      }
      n.params.forEach((x) => declare(x, scope.vars));
    } else if (["BlockStatement", "ForStatement", "ForOfStatement", "CatchClause"].includes(n.type)) {
      scope = { parent: scope, vars: new Map() };
      if (n.param) declare(n.param, scope.vars);
    } else if (n.type === "VariableDeclaration") {
      if (n.kind === "var") fail("未分析的 var 作用域");
      n.declarations.forEach((d) => declare(d.id, scope.vars));
    }
    if (
      n.type === "AssignmentExpression" &&
      n.left.type === "MemberExpression" &&
      n.left.object.name === "globalThis" &&
      !n.left.computed
    )
      cell(globals, n.left.property.name);
    scopes.set(n, scope);
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) {
        for (const e of v) if (e?.type) prepare(e, scope);
      } else if (v?.type) prepare(v, scope);
    }
  }
  function keyValues(member) {
    if (!member.computed) {
      check(member.property.name);
      return [member.property.name];
    }
    const result = [];
    for (const v of visit(member.property)) {
      if (typeof v === "number") result.push(String(v));
      else if (v === num) result.push("#index");
      else if (v === nil) result.push("null", "true", "false", "undefined");
      else if (typeof v === "string" && v.startsWith("=")) {
        check(v.slice(1));
        result.push(v.slice(1));
      } else result.push("*key");
    }
    return result;
  }
  function primitive(value) {
    return (
      value === nil || value === num || value === text || typeof value === "number" || stringValue(value)
    );
  }
  function readObject(obj, key) {
    if (key === "*key")
      return [opaque, data, ...[...(fields.get(obj)?.values() ?? [])].flatMap((x) => [...x])];
    const result = primitive(obj) ? [] : [...field(obj, key)];
    if ((key === "#index" || /^\d+$/.test(key)) && (obj === text || stringValue(obj))) {
      if (obj.startsWith("=") && key !== "#index") {
        const ch = obj.slice(1)[Number(key)];
        if (ch !== undefined) result.push("=" + ch);
      } else result.push(text);
    }
    if (!primitive(obj) && (key === "#index" || /^\d+$/.test(key))) result.push(...field(obj, "#index"));
    if (obj === opaque) result.push(opaque);
    else if (obj === "@global") result.push(...(globals.get(key) ?? [opaque]));
    else if (
      obj === "@canvas" ||
      obj === "@rm2k3" ||
      obj === "@picture" ||
      ["@Math", "@JSON", "@Array", "@Object"].includes(obj)
    ) {
      if (obj === "@picture" && key === "file") result.push(text);
      else if (obj === "@picture" && key === "id") result.push(num);
      else result.push(native(obj.slice(1) + "." + key));
    } else {
      if (typeof obj === "string" && obj.startsWith("@")) result.push(opaque);
      if (obj === data) result.push(data);
      if (isFunction(obj) && key === "name") result.push(text);
      if (inherited.has(key) && !methods.has(key) && key !== "length" && key !== "name") result.push(opaque);
      if (methods.has(key)) result.push(native("method." + key));
      if (key === "length") result.push(num);
    }
    result.push(nil); // Missing properties read as undefined, including on another branch.
    return result;
  }
  function elements(values) {
    if (values.some((v) => typeof v === "string" && v.startsWith("@"))) fail("迭代宿主对象");
    return values.flatMap((v) =>
      v === data
        ? [data]
        : v === opaque
          ? [opaque]
          : typeof v === "string" && (v === text || stringValue(v))
            ? [text]
            : [...field(v, "#index")],
    );
  }
  function assign(n, values) {
    if (n.type === "Identifier") put(binding(scopes.get(n), n.name), values);
    else if (n.type === "AssignmentPattern") assign(n.left, [...values, ...visit(n.right)]);
    else if (n.type === "ArrayPattern")
      n.elements.forEach(
        (e, i) =>
          e &&
          assign(
            e,
            values.flatMap((v) => readObject(v, String(i))),
          ),
      );
    else if (n.type === "MemberExpression") {
      const objects = visit(n.object),
        keys = keyValues(n);
      for (const o of objects)
        for (const k of keys) {
          if (primitive(o)) continue; // Primitive property assignments do not persist.
          if (k === "*key" || o === opaque) fail("动态写入对象属性");
          if (o === "@picture" && k === "file") {
            put(effects, values);
            continue;
          }
          if (o === "@global") put(binding(null, k), values);
          else if (typeof o === "string" && o.startsWith("@")) fail("改写宿主接口 " + k);
          else {
            put(field(o, k), values);
            if (/^\d+$/.test(k)) put(field(o, "#index"), values);
          }
        }
    } else fail("未分析的赋值 " + n.type);
  }
  function plus(left, right) {
    const values = [];
    left = [...new Set(left)];
    right = [...new Set(right)];
    if (left.length * right.length > 2048) return [text, num];
    for (const x of left)
      for (const y of right) {
        if (typeof x === "number" && typeof y === "number") values.push(x + y);
        else if (
          (typeof x === "number" || x === num || x === nil) &&
          (typeof y === "number" || y === num || y === nil)
        )
          values.push(num);
        else if (typeof x === "string" && x.startsWith("=") && typeof y === "number")
          values.push(x + String(y));
        else if (typeof x === "number" && typeof y === "string" && y.startsWith("="))
          values.push("=" + String(x) + y.slice(1));
        else if (typeof x === "string" && x.startsWith("=") && typeof y === "string" && y.startsWith("="))
          values.push(x + y.slice(1));
        else if (typeof x === "string" && x.startsWith("=") && y === num) values.push("%" + x.slice(1));
        else if (typeof x === "string" && x.startsWith("=") && y === nil)
          values.push(x + "undefined", x + "null", x + "true", x + "false");
        else values.push(text);
      }
    return values;
  }
  function invoke(target, args, call, receiver) {
    if (isFunction(target)) {
      target.params.forEach((p, i) => assign(p, args[i] ?? [nil]));
      return [...cell(returns, target), nil];
    }
    if (target === opaque) fail("无法限定被调用的函数");
    if (typeof target !== "string" || !target.startsWith("@")) return []; // non-callable data
    const name = target.slice(1),
      arg = args[0] ?? [nil];
    if (name === "rm2k3.setNetplayOverlay") {
      for (const cb of arg) if (cb !== nil) invoke(cb, [["@canvas"], [num], [num], [num]], call, []);
      return [nil];
    }
    if (name === "canvas.picture") {
      put(effects, arg);
      return [nil];
    }
    if (name === "canvas.avatar") {
      put(effects, ["=NetplayDefaultAvatar"]);
      return [nil];
    }
    if (name === "rm2k3.getPicture") return ["@picture"];
    const [base, method] = name.split(".");
    if (base === "rm2k3" && ["netplayPosition", "netplayProject", "netplayUpcoming"].includes(method))
      return [data];
    if (["getv", "gets", "gett"].includes(name) && args.length > 1) return [data];
    if (["gets", "Boolean"].includes(name)) return [nil];
    if (
      (base === "rm2k3" && pureHost.has(method)) ||
      (base === "canvas" && canvasMethods.has(method)) ||
      (base === "picture" && ["show", "move", "scale", "erase"].includes(method))
    )
      return [num, nil];
    if ((base === "Math" && math.has(method)) || ["getv", "Number"].includes(name)) return [num];
    if (name === "sett") writesStrings = true;
    if (["setv", "sets", "sett"].includes(name)) return [nil];
    if (["String", "gett"].includes(name)) return [text];
    if (name === "JSON.parse" && args.length === 1) return [data];
    if (name === "JSON.stringify" && args.length === 1) return [text];
    if (name === "Object.keys" || name === "Object.entries") {
      if (arg.some((o) => o === opaque || (typeof o === "string" && o.startsWith("@")))) fail("枚举宿主对象");
      if (name === "Object.keys") put(field(call, "#index"), [text]);
      else {
        const pair = call.callee;
        put(field(pair, "0"), [text]);
        put(
          field(pair, "1"),
          arg.flatMap((v) =>
            v === data
              ? [data]
              : v === opaque
                ? [opaque]
                : v === text || stringValue(v)
                  ? [text]
                  : [...(fields.get(v)?.values() ?? [])].flatMap((x) => [...x]),
          ),
        );
        put(field(pair, "#index"), [...field(pair, "0"), ...field(pair, "1")]);
        put(field(call, "#index"), [pair]);
      }
      return [call];
    }
    if (name === "Array.from" || base === "method") {
      const items = elements(name === "Array.from" ? arg : receiver);
      const cb = name === "Array.from" ? args[1] : args[0];
      if (["map", "find", "forEach"].includes(method) || (name === "Array.from" && cb)) {
        const results = (cb ?? []).flatMap((f) => invoke(f, [items, [num], receiver], call, []));
        if (method === "find") return [...items, nil];
        if (method === "forEach") return [nil];
        put(field(call, "#index"), results);
        return [call];
      }
      if (name === "Array.from" || method === "slice") {
        put(field(call, "#index"), items);
        return [call, text];
      }
      if (method === "push") {
        for (const obj of receiver) if (!primitive(obj)) for (const a of args) put(field(obj, "#index"), a);
        return [num];
      }
      if (method === "join") return [text];
      if (method === "includes") return [nil];
      if (method === "replace") {
        if (
          !args[1]?.every(
            (x) => stringValue(x) || x === text || x === nil || x === num || typeof x === "number",
          )
        )
          fail("动态替换回调");
        return [text];
      }
    }
    fail("未分析的宿主调用 " + name);
  }

  // A selector of the form options.includes(id) ? id : fallback can keep the
  // table's finite values. Only the unmodified Array intrinsic is a certificate.
  function selectedNumbers(test, id, evaluate) {
    const same = (n) => n.type === "Identifier" && n.name === id.name;
    if (test.type === "LogicalExpression" && test.operator === "||") {
      const a = selectedNumbers(test.left, id, evaluate),
        b = selectedNumbers(test.right, id, evaluate);
      return a && b ? [...a, ...b] : null;
    }
    if (test.type === "BinaryExpression" && test.operator === "===") {
      const other = same(test.left) ? test.right : same(test.right) ? test.left : null;
      if (other?.type === "Literal" && typeof other.value === "number") return [other.value];
    }
    const callee = test.callee;
    if (
      test.type !== "CallExpression" ||
      callee.type !== "MemberExpression" ||
      callee.computed ||
      callee.property.name !== "includes" ||
      callee.object.type !== "Identifier" ||
      test.arguments.length !== 1 ||
      !same(test.arguments[0])
    )
      return null;
    const options = [];
    for (const obj of evaluate(callee.object)) {
      if (obj === nil) continue;
      if (obj?.type !== "ArrayExpression" || field(obj, "includes").size) return null;
      const values = [...field(obj, "#index")];
      if (values.some((v) => typeof v !== "number")) return null;
      options.push(...values);
    }
    return options;
  }
  function visit(n, fn) {
    if (!n) return [];
    if (++work > 2400000) fail("脚本值传播超过预算");
    const v = (x) => visit(x, fn),
      scope = scopes.get(n);
    switch (n.type) {
      case "Program":
      case "BlockStatement":
        n.body.forEach(v);
        break;
      case "FunctionDeclaration":
        break;
      case "ArrowFunctionExpression":
      case "FunctionExpression":
        return [n];
      case "Identifier": {
        check(n.name);
        for (let s = scope; s; s = s.parent) if (s.vars.has(n.name)) return [...s.vars.get(n.name)];
        return [...(globals.get(n.name) ?? [opaque])];
      }
      case "Literal":
        if (n.bigint) fail("BigInt 文件名运算");
        if (n.regex) return [text];
        return [typeof n.value === "number" ? n.value : typeof n.value === "string" ? "=" + n.value : nil];
      case "ObjectExpression":
        for (const prop of n.properties) {
          if (prop.type !== "Property" || prop.computed || prop.kind !== "init") fail("动态对象定义");
          const key = prop.key.name ?? String(prop.key.value);
          check(key);
          put(field(n, key), v(prop.value));
          if (/^\d+$/.test(key)) put(field(n, "#index"), v(prop.value));
        }
        return [n];
      case "ArrayExpression":
        for (const e of n.elements)
          if (e) put(field(n, "#index"), e.type === "SpreadElement" ? elements(v(e.argument)) : v(e));
        return [n];
      case "VariableDeclaration":
        for (const d of n.declarations) assign(d.id, d.init ? v(d.init) : [nil]);
        break;
      case "ExpressionStatement":
        return v(n.expression);
      case "MemberExpression": {
        const keys = keyValues(n);
        return v(n.object).flatMap((o) => keys.flatMap((k) => readObject(o, k)));
      }
      case "CallExpression": {
        const args = n.arguments.map(v);
        let targets,
          receiver = [];
        if (n.callee.type === "MemberExpression") {
          receiver = [...new Set(v(n.callee.object))];
          const keys = [...new Set(keyValues(n.callee))];
          targets = receiver.flatMap((obj) => keys.flatMap((k) => readObject(obj, k)));
        } else targets = v(n.callee);
        return [...new Set([...new Set(targets)].flatMap((t) => invoke(t, args, n, receiver)))];
      }
      case "AssignmentExpression": {
        const r = v(n.right),
          out =
            n.operator === "="
              ? r
              : n.operator === "+="
                ? plus(v(n.left), r)
                : ["&&=", "||=", "??="].includes(n.operator)
                  ? [...v(n.left), ...r]
                  : [num];
        assign(n.left, out);
        return out;
      }
      case "UpdateExpression":
        assign(n.argument, [num]);
        return [num];
      case "UnaryExpression":
        v(n.argument);
        return [
          n.operator === "typeof"
            ? text
            : n.operator === "void" || n.operator === "!" || n.operator === "delete"
              ? nil
              : num,
        ];
      case "BinaryExpression": {
        const l = v(n.left),
          r = v(n.right);
        return n.operator === "+"
          ? plus(l, r)
          : ["===", "!==", "==", "!=", "<", ">", "<=", ">=", "in", "instanceof"].includes(n.operator)
            ? [nil]
            : [num];
      }
      case "LogicalExpression":
        return [...v(n.left), ...v(n.right)];
      case "ChainExpression":
        return v(n.expression);
      case "ConditionalExpression": {
        v(n.test);
        const narrowed = n.consequent.type === "Identifier" ? selectedNumbers(n.test, n.consequent, v) : null;
        return [...(narrowed ?? v(n.consequent)), ...v(n.alternate)];
      }
      case "IfStatement":
        v(n.test);
        v(n.consequent);
        v(n.alternate);
        break;
      case "ForStatement":
        v(n.init);
        v(n.test);
        v(n.update);
        v(n.body);
        break;
      case "ForOfStatement":
        assign(
          n.left.type === "VariableDeclaration" ? n.left.declarations[0].id : n.left,
          elements(v(n.right)),
        );
        v(n.body);
        break;
      case "TryStatement":
        v(n.block);
        v(n.handler);
        v(n.finalizer);
        break;
      case "CatchClause":
        if (n.param) assign(n.param, [opaque]);
        v(n.body);
        break;
      case "ReturnStatement":
        put(cell(returns, fn), v(n.argument));
        break;
      case "BreakStatement":
      case "ContinueStatement":
      case "EmptyStatement":
        break;
      default:
        fail("未分析的语法 " + n.type);
    }
    return [];
  }
  try {
    for (const g of [
      "Math",
      "Number",
      "String",
      "Boolean",
      "Array",
      "Object",
      "JSON",
      "rm2k3",
      "getv",
      "gett",
      "gets",
      "setv",
      "sett",
      "sets",
    ])
      put(cell(globals, g), [native(g)]);
    put(cell(globals, "globalThis"), ["@global"]);
    put(cell(globals, "undefined"), [nil]);
    for (const [script, file] of scripts) {
      source = file;
      const ast = parse(script, { ecmaVersion: 2022 });
      prepare(ast, { parent: null, vars: globals });
      programs.push([ast, file]);
    }
    for (let pass = 0; pass < 64; pass++) {
      changed = false;
      for (const [ast, file] of programs) {
        source = file;
        visit(ast);
      }
      for (const f of functions) {
        source = owners.get(f);
        const r = visit(f.body, f);
        if (f.body.type !== "BlockStatement") put(cell(returns, f), r);
      }
      if (!changed)
        return {
          writesStrings,
          effects: [...effects].flatMap((v) =>
            v === nil
              ? ["=undefined", "=null", "=true", "=false"]
              : [typeof v === "number" ? "=" + String(v) : stringValue(v) ? v : v === num ? "%" : "*"],
          ),
        };
    }
    return { error: source + " (3030) 脚本值传播未收敛" };
  } catch (error) {
    return { error: source + " (3030) " + error.message };
  }
}

// Footprint for a single event record. A continuation, unknown callee, dynamic
// destination or compound script still invalidates the event-local number facts.
export function directNumberWrites(bytes) {
  if (bytes.length > 2048 || bytes.some((b) => b > 127)) return null;
  let program;
  try {
    program = parse(new TextDecoder().decode(bytes), { ecmaVersion: 2022 });
  } catch {
    return null;
  }
  const targets = new Set();
  function pure(n) {
    if (n.type === "Literal") return typeof n.value === "number" || typeof n.value === "boolean";
    if (n.type === "CallExpression")
      return (
        n.callee.type === "Identifier" &&
        ["getv", "gets", "Number", "Boolean"].includes(n.callee.name) &&
        n.arguments.length === 1 &&
        pure(n.arguments[0])
      );
    if (n.type === "UnaryExpression") return ["!", "~", "+", "-"].includes(n.operator) && pure(n.argument);
    if (n.type === "BinaryExpression" || n.type === "LogicalExpression") return pure(n.left) && pure(n.right);
    return n.type === "ConditionalExpression" && pure(n.test) && pure(n.consequent) && pure(n.alternate);
  }
  function statement(n) {
    if (n.type === "BlockStatement") return n.body.every(statement);
    if (n.type === "IfStatement")
      return pure(n.test) && statement(n.consequent) && (!n.alternate || statement(n.alternate));
    if (n.type === "EmptyStatement") return true;
    if (n.type !== "ExpressionStatement") return false;
    const call = n.expression;
    if (
      call.type !== "CallExpression" ||
      call.callee.type !== "Identifier" ||
      call.callee.name !== "setv" ||
      call.arguments.length !== 2
    )
      return false;
    const [id, value] = call.arguments;
    if (
      id.type !== "Literal" ||
      !Number.isInteger(id.value) ||
      id.value <= 0 ||
      id.value > 2147483647 ||
      !pure(value)
    )
      return false;
    targets.add(id.value);
    return true;
  }
  return program.body.every(statement) ? [...targets] : null;
}
