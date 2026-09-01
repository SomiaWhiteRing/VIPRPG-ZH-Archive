(() => {
  "use strict";

  const REVIEW_PAGE_PATH = "/viprpg_sozai/pages/1.html";
  const STORAGE_KEY = "viprpg-character-portrait-review.v1";
  const DICTIONARY_STORAGE_KEY = "viprpg-character-portrait-dictionary.v1";
  const RECENT_PAGES_STORAGE_KEY = "viprpg-character-portrait-recent-pages.v1";
  const FETCH_IMAGE_MESSAGE = "viprpg-material-cropper:fetch-image";
  const DICTIONARY_SCHEMA = "viprpg-character-dictionary.v1";
  const MAPPING_SCHEMA = "viprpg-character-portrait-map.v1";
  const FACE_SHEET_SIZE = 192;
  const PORTRAIT_SIZE = 48;
  const SEARCH_RESULT_LIMIT = 12;

  if (location.pathname !== REVIEW_PAGE_PATH) {
    return;
  }

  const controlPanel = document.querySelector("#viprpg-material-cropper-panel");
  if (!(controlPanel instanceof HTMLElement)) {
    return;
  }

  const launchButton = document.createElement("button");
  launchButton.id = "viprpg-portrait-review-launch";
  launchButton.type = "button";
  launchButton.textContent = "逐角色确认头像";
  controlPanel.append(launchButton);

  const review = document.createElement("div");
  review.id = "viprpg-portrait-review";
  review.hidden = true;
  review.innerHTML = `
    <section class="viprpg-portrait-review-dialog" role="dialog" aria-modal="true" aria-labelledby="viprpg-portrait-review-title">
      <header class="viprpg-portrait-review-header">
        <div>
          <h2 class="viprpg-portrait-review-title" id="viprpg-portrait-review-title">角色头像确认</h2>
          <div class="viprpg-portrait-review-muted">每个角色确认一张 48×48 头像，进度自动保存。</div>
        </div>
        <div class="viprpg-portrait-review-actions">
          <label class="viprpg-portrait-review-button viprpg-portrait-review-file">
            <span id="viprpg-portrait-review-dictionary-label">导入角色字典</span>
            <input id="viprpg-portrait-review-dictionary" type="file" accept="application/json,.json">
          </label>
          <button class="viprpg-portrait-review-button" id="viprpg-portrait-review-close" type="button">关闭</button>
        </div>
      </header>
      <div class="viprpg-portrait-review-context">
        <div class="viprpg-portrait-review-toolbar">
          <div class="viprpg-portrait-review-actions viprpg-portrait-review-navigation">
            <button class="viprpg-portrait-review-button" id="viprpg-portrait-review-previous" type="button" disabled>上一个</button>
            <select aria-label="当前角色" class="viprpg-portrait-review-select" id="viprpg-portrait-review-jump" disabled></select>
            <button class="viprpg-portrait-review-button" id="viprpg-portrait-review-next" type="button" disabled>下一个</button>
            <button class="viprpg-portrait-review-button" id="viprpg-portrait-review-next-unreviewed" type="button" disabled>下个未确认</button>
          </div>
          <div class="viprpg-portrait-review-character" id="viprpg-portrait-review-character">
            <strong>请先导入角色字典</strong>
          </div>
          <button class="viprpg-portrait-review-button" id="viprpg-portrait-review-edit-aliases" type="button" disabled>编辑别名</button>
          <div class="viprpg-portrait-review-muted" id="viprpg-portrait-review-progress">尚未载入角色。</div>
        </div>
        <section class="viprpg-portrait-review-alias-editor" id="viprpg-portrait-review-alias-editor" hidden>
          <div class="viprpg-portrait-review-sheet-heading">
            <strong id="viprpg-portrait-review-alias-title">编辑别名</strong>
            <span class="viprpg-portrait-review-muted">原名和主译名不在这里修改。</span>
          </div>
          <div class="viprpg-portrait-review-alias-rows" id="viprpg-portrait-review-alias-rows"></div>
          <div class="viprpg-portrait-review-actions">
            <button class="viprpg-portrait-review-button" id="viprpg-portrait-review-add-alias" type="button">增加别名</button>
            <span class="viprpg-portrait-review-error" id="viprpg-portrait-review-alias-error" role="alert"></span>
            <span class="viprpg-portrait-review-alias-spacer"></span>
            <button class="viprpg-portrait-review-button" id="viprpg-portrait-review-cancel-aliases" type="button">取消</button>
            <button class="viprpg-portrait-review-button" data-primary="true" id="viprpg-portrait-review-save-aliases" type="button">保存别名</button>
          </div>
        </section>
      </div>
      <div class="viprpg-portrait-review-body">
        <section class="viprpg-portrait-review-pane viprpg-portrait-review-stack" aria-label="素材页与脸图">
          <strong>选择素材页</strong>
          <input class="viprpg-portrait-review-input" id="viprpg-portrait-review-page-search" type="search" placeholder="页名、角色名、#页码或 atwiki URL" disabled>
          <div class="viprpg-portrait-review-pages" id="viprpg-portrait-review-pages"></div>
          <a class="viprpg-portrait-review-muted" id="viprpg-portrait-review-source-page" target="_blank" rel="noreferrer" hidden>打开当前素材页</a>
          <strong>脸图素材表</strong>
          <div class="viprpg-portrait-review-sheets" id="viprpg-portrait-review-sheets"></div>
          <div class="viprpg-portrait-review-muted" id="viprpg-portrait-review-page-status">导入字典后会按角色原名匹配当前索引页。</div>
        </section>
        <section class="viprpg-portrait-review-pane viprpg-portrait-review-stack" aria-label="头像格子">
          <strong>选择头像</strong>
          <div class="viprpg-portrait-review-grid" id="viprpg-portrait-review-grid" hidden></div>
          <div class="viprpg-portrait-review-actions viprpg-portrait-review-confirm-bar">
            <strong id="viprpg-portrait-review-selection">尚未选择头像</strong>
            <span class="viprpg-portrait-review-confirm-spacer"></span>
            <button class="viprpg-portrait-review-button" data-primary="true" id="viprpg-portrait-review-confirm" type="button" disabled>确认这一张</button>
            <button class="viprpg-portrait-review-button" id="viprpg-portrait-review-skip" type="button" disabled>暂不设置</button>
          </div>
        </section>
      </div>
      <footer class="viprpg-portrait-review-footer">
        <div class="viprpg-portrait-review-muted" id="viprpg-portrait-review-export-status">确认结果仅保存在本机扩展中，不会上传。</div>
        <div class="viprpg-portrait-review-actions">
          <button class="viprpg-portrait-review-button" id="viprpg-portrait-review-export-dictionary" type="button" disabled>导出角色字典</button>
          <button class="viprpg-portrait-review-button" id="viprpg-portrait-review-export-map" type="button" disabled>导出映射 JSON</button>
          <button class="viprpg-portrait-review-button" data-primary="true" id="viprpg-portrait-review-export-pack" type="button" disabled>导出头像包 ZIP</button>
        </div>
      </footer>
    </section>
  `;
  document.documentElement.append(review);

  const elements = {
    close: requiredElement("viprpg-portrait-review-close", HTMLButtonElement),
    dictionary: requiredElement("viprpg-portrait-review-dictionary", HTMLInputElement),
    dictionaryLabel: requiredElement("viprpg-portrait-review-dictionary-label", HTMLElement),
    editAliases: requiredElement("viprpg-portrait-review-edit-aliases", HTMLButtonElement),
    aliasEditor: requiredElement("viprpg-portrait-review-alias-editor", HTMLElement),
    aliasTitle: requiredElement("viprpg-portrait-review-alias-title", HTMLElement),
    aliasRows: requiredElement("viprpg-portrait-review-alias-rows", HTMLElement),
    aliasError: requiredElement("viprpg-portrait-review-alias-error", HTMLElement),
    addAlias: requiredElement("viprpg-portrait-review-add-alias", HTMLButtonElement),
    cancelAliases: requiredElement("viprpg-portrait-review-cancel-aliases", HTMLButtonElement),
    saveAliases: requiredElement("viprpg-portrait-review-save-aliases", HTMLButtonElement),
    jump: requiredElement("viprpg-portrait-review-jump", HTMLSelectElement),
    character: requiredElement("viprpg-portrait-review-character", HTMLElement),
    previous: requiredElement("viprpg-portrait-review-previous", HTMLButtonElement),
    next: requiredElement("viprpg-portrait-review-next", HTMLButtonElement),
    nextUnreviewed: requiredElement("viprpg-portrait-review-next-unreviewed", HTMLButtonElement),
    progress: requiredElement("viprpg-portrait-review-progress", HTMLElement),
    pageSearch: requiredElement("viprpg-portrait-review-page-search", HTMLInputElement),
    pages: requiredElement("viprpg-portrait-review-pages", HTMLElement),
    sourcePage: requiredElement("viprpg-portrait-review-source-page", HTMLAnchorElement),
    sheets: requiredElement("viprpg-portrait-review-sheets", HTMLElement),
    pageStatus: requiredElement("viprpg-portrait-review-page-status", HTMLElement),
    grid: requiredElement("viprpg-portrait-review-grid", HTMLElement),
    selection: requiredElement("viprpg-portrait-review-selection", HTMLElement),
    confirm: requiredElement("viprpg-portrait-review-confirm", HTMLButtonElement),
    skip: requiredElement("viprpg-portrait-review-skip", HTMLButtonElement),
    exportMap: requiredElement("viprpg-portrait-review-export-map", HTMLButtonElement),
    exportDictionary: requiredElement("viprpg-portrait-review-export-dictionary", HTMLButtonElement),
    exportPack: requiredElement("viprpg-portrait-review-export-pack", HTMLButtonElement),
    exportStatus: requiredElement("viprpg-portrait-review-export-status", HTMLElement),
  };

  const state = {
    characters: [],
    pages: collectWikiPages(),
    decisions: {},
    index: 0,
    selectedPage: null,
    sheets: [],
    activeSheetUrl: null,
    pending: null,
    pageLoadToken: 0,
    exporting: false,
    recentPages: [],
    aliasDraft: null,
    discoveryController: null,
    discoveryToken: 0,
    searchResultCache: new Map(),
    faceSheetCache: new Map(),
  };

  launchButton.addEventListener("click", async () => {
    await stateRestored;
    review.hidden = false;
    if (state.characters.length) showCharacter(state.index);
    elements.close.focus();
  });
  elements.close.addEventListener("click", closeReview);
  review.addEventListener("click", (event) => {
    if (event.target === review) closeReview();
  });
  review.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeReview();
  });
  elements.dictionary.addEventListener("change", importDictionary);
  elements.editAliases.addEventListener("click", openAliasEditor);
  elements.addAlias.addEventListener("click", addAliasDraft);
  elements.cancelAliases.addEventListener("click", closeAliasEditor);
  elements.saveAliases.addEventListener("click", saveAliases);
  elements.jump.addEventListener("change", () => showCharacter(Number(elements.jump.value)));
  elements.previous.addEventListener("click", () => showCharacter(state.index - 1));
  elements.next.addEventListener("click", () => showCharacter(state.index + 1));
  elements.nextUnreviewed.addEventListener("click", showNextUnreviewed);
  elements.pageSearch.addEventListener("input", () => {
    cancelDiscovery();
    renderPageCandidates();
  });
  elements.pageSearch.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const candidate = pageCandidates(currentCharacter(), elements.pageSearch.value)[0];
    event.preventDefault();
    if (candidate) {
      void selectPage(candidate.page);
      return;
    }
    const query = normalizedText(elements.pageSearch.value);
    if (query) void discoverFirstFacePage([query]);
  });
  elements.confirm.addEventListener("click", confirmPortrait);
  elements.skip.addEventListener("click", skipCharacter);
  elements.exportMap.addEventListener("click", exportMapping);
  elements.exportDictionary.addEventListener("click", exportDictionary);
  elements.exportPack.addEventListener("click", exportPack);

  const stateRestored = restoreState();

  async function restoreState() {
    try {
      const [savedDecisions, savedDictionary, savedRecentPages] = await Promise.all([
        storageGet(STORAGE_KEY),
        storageGet(DICTIONARY_STORAGE_KEY),
        storageGet(RECENT_PAGES_STORAGE_KEY),
      ]);
      if (savedDecisions && typeof savedDecisions === "object" && !Array.isArray(savedDecisions)) {
        state.decisions = savedDecisions;
      }
      if (Array.isArray(savedRecentPages)) {
        state.recentPages = savedRecentPages.filter(isWikiPage).slice(0, 4);
      }
      if (savedDictionary) {
        applyDictionary(parseDictionary(savedDictionary), false);
        elements.exportStatus.textContent = "已恢复角色字典和确认进度。";
      }
    } catch (error) {
      console.error("[VIPRPG 角色头像确认] 无法恢复进度", error);
      elements.exportStatus.textContent = "无法读取已保存进度；本次确认仍可导出。";
      elements.exportStatus.className = "viprpg-portrait-review-error";
    }
  }

  async function importDictionary() {
    await stateRestored;
    const file = elements.dictionary.files?.[0];
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text());
      applyDictionary(parseDictionary(parsed));
      await storageSet(DICTIONARY_STORAGE_KEY, dictionaryPayload());
      elements.exportStatus.className = "viprpg-portrait-review-muted";
      elements.exportStatus.textContent = `已导入 ${state.characters.length} 个角色。`;
    } catch (error) {
      elements.dictionary.value = "";
      elements.exportStatus.className = "viprpg-portrait-review-error";
      elements.exportStatus.textContent = `字典导入失败：${errorMessage(error)}`;
      if (!state.characters.length) {
        elements.character.replaceChildren(messageNode(errorMessage(error), true));
        disableReviewControls();
      }
    }
  }

  function parseDictionary(parsed) {
    if (parsed?.schema !== DICTIONARY_SCHEMA || !Array.isArray(parsed.characters)) {
      throw new Error(`只接受 ${DICTIONARY_SCHEMA}。`);
    }
    const seen = new Set();
    const characters = parsed.characters.map((value, index) => {
      const originalName = normalizedText(value?.originalName);
      const primaryName = normalizedText(value?.primaryName);
      const originalKey = aliasKey(originalName);
      if (!originalName || !primaryName || seen.has(originalKey)) {
        throw new Error(`第 ${index + 1} 个角色缺少唯一的原名或主译名。`);
      }
      seen.add(originalKey);
      const aliasKeys = new Set([aliasKey(originalName), aliasKey(primaryName)]);
      const aliases = (Array.isArray(value.aliases) ? value.aliases : []).map(
        (alias, aliasIndex) => {
          const name = normalizedText(alias?.name);
          const language = alias?.language;
          if (!name || !["ja", "zh"].includes(language)) {
            throw new Error(
              `第 ${index + 1} 个角色的第 ${aliasIndex + 1} 个别名格式不合法。`,
            );
          }
          const key = aliasKey(name);
          if (aliasKeys.has(key)) {
            throw new Error(`角色“${originalName}”包含重复别名“${name}”。`);
          }
          aliasKeys.add(key);
          const source = normalizedText(alias.source) || "user";
          if (!["base", "sub", "user", "admin"].includes(source)) {
            throw new Error(`角色“${originalName}”的别名“${name}”来源不合法。`);
          }
          return {
            name,
            language,
            source,
          };
        },
      );
      return { originalName, primaryName, aliases };
    });
    assertJapaneseNamesUnique(characters);
    return characters;
  }

  function applyDictionary(characters, show = true) {
    state.characters = characters;
    state.index = Math.max(0, characters.findIndex((item) => !state.decisions[item.originalName]));
    elements.dictionaryLabel.textContent = "更换角色字典";
    populateCharacterJump();
    if (show) showCharacter(state.index);
  }

  function populateCharacterJump() {
    elements.jump.replaceChildren(
      ...state.characters.map((character, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = `${index + 1}. ${character.originalName} / ${character.primaryName}`;
        return option;
      }),
    );
    elements.jump.disabled = state.characters.length === 0;
  }

  function showCharacter(requestedIndex) {
    if (!state.characters.length) return;
    cancelDiscovery();
    closeAliasEditor();
    state.index = Math.min(Math.max(0, requestedIndex), state.characters.length - 1);
    state.selectedPage = null;
    state.sheets = [];
    state.activeSheetUrl = null;
    state.pending = null;
    state.pageLoadToken += 1;
    elements.jump.value = String(state.index);
    elements.pageSearch.value = "";

    const character = currentCharacter();
    const decision = state.decisions[character.originalName];
    renderCharacterSummary(character, decision);

    elements.previous.disabled = state.index === 0;
    elements.next.disabled = state.index === state.characters.length - 1;
    elements.nextUnreviewed.disabled = false;
    elements.editAliases.disabled = false;
    elements.pageSearch.disabled = false;
    elements.skip.disabled = false;
    elements.exportDictionary.disabled = false;
    elements.exportMap.disabled = false;
    elements.exportPack.disabled = confirmedDecisions().length === 0;
    renderProgress();
    renderPageCandidates();
    renderSheets();
    renderGrid();

    if (decision?.status === "confirmed") {
      const savedPage = allWikiPages().find((page) => page.url === decision.sourcePageUrl) ?? {
        title: decision.sourcePageTitle || character.originalName,
        url: decision.sourcePageUrl,
      };
      state.pending = {
        sourceImageUrl: decision.sourceImageUrl,
        row: decision.row,
        column: decision.column,
      };
      void selectPage(savedPage, decision.sourceImageUrl);
      return;
    }

    const candidates = pageCandidates(character, "");
    if (candidates.length && candidates[0].score <= 1) {
      void selectPage(candidates[0].page);
      return;
    }
    void discoverFirstFacePage(characterSearchTerms(character));
  }

  function renderCharacterSummary(character, decision) {
    const japaneseAliases = character.aliases
      .filter((alias) => alias.language === "ja")
      .map((alias) => alias.name);
    const chineseAliases = character.aliases
      .filter((alias) => alias.language === "zh")
      .map((alias) => alias.name);
    const aliases = [
      japaneseAliases.length ? `日：${japaneseAliases.join("、")}` : null,
      chineseAliases.length ? `中：${chineseAliases.join("、")}` : null,
    ].filter(Boolean).join("；") || "无别名";
    const decisionText =
      decision?.status === "confirmed"
        ? "已确认头像"
        : decision?.status === "skipped"
          ? "已标记暂不设置"
          : "尚未确认";
    elements.character.replaceChildren(
      textElement("strong", character.originalName),
      textElement("span", character.primaryName, "viprpg-portrait-review-muted"),
      textElement("span", aliases, "viprpg-portrait-review-muted"),
      textElement("span", decisionText, "viprpg-portrait-review-muted"),
    );
  }

  function openAliasEditor() {
    const character = currentCharacter();
    if (!character) return;
    state.aliasDraft = character.aliases.map((alias) => ({ ...alias }));
    elements.aliasTitle.textContent = `编辑 ${character.originalName} 的别名`;
    elements.aliasError.textContent = "";
    elements.aliasEditor.hidden = false;
    renderAliasRows();
  }

  function closeAliasEditor() {
    state.aliasDraft = null;
    elements.aliasError.textContent = "";
    elements.aliasEditor.hidden = true;
  }

  function addAliasDraft() {
    if (!state.aliasDraft) return;
    state.aliasDraft.push({ name: "", language: "ja", source: "admin" });
    renderAliasRows(state.aliasDraft.length - 1);
  }

  function renderAliasRows(focusIndex = -1) {
    const aliases = state.aliasDraft;
    if (!aliases) return;
    if (!aliases.length) {
      elements.aliasRows.replaceChildren(messageNode("还没有别名。"));
      return;
    }

    elements.aliasRows.replaceChildren(
      ...aliases.map((alias, index) => {
        const row = document.createElement("div");
        row.className = "viprpg-portrait-review-alias-row";
        const language = document.createElement("select");
        language.className = "viprpg-portrait-review-select";
        language.ariaLabel = `第 ${index + 1} 个别名的语言`;
        for (const [value, label] of [["ja", "日文"], ["zh", "中文"]]) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label;
          option.selected = alias.language === value;
          language.append(option);
        }
        language.addEventListener("change", () => {
          alias.language = language.value;
          alias.source = "admin";
          source.textContent = "人工";
          elements.aliasError.textContent = "";
        });

        const name = document.createElement("input");
        name.className = "viprpg-portrait-review-input";
        name.type = "text";
        name.value = alias.name;
        name.placeholder = "别名";
        name.ariaLabel = `第 ${index + 1} 个别名`;
        name.addEventListener("input", () => {
          alias.name = name.value;
          alias.source = "admin";
          source.textContent = "人工";
          elements.aliasError.textContent = "";
        });

        const source = textElement(
          "span",
          aliasSourceLabel(alias.source),
          "viprpg-portrait-review-muted",
        );
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "viprpg-portrait-review-button";
        remove.textContent = "删除";
        remove.ariaLabel = `删除别名 ${alias.name || index + 1}`;
        remove.addEventListener("click", () => {
          aliases.splice(index, 1);
          renderAliasRows();
        });
        row.append(language, name, source, remove);
        if (index === focusIndex) window.setTimeout(() => name.focus(), 0);
        return row;
      }),
    );
  }

  async function saveAliases() {
    const character = currentCharacter();
    if (!character || !state.aliasDraft) return;
    try {
      const seen = new Set([
        aliasKey(character.originalName),
        aliasKey(character.primaryName),
      ]);
      const aliases = state.aliasDraft.map((alias, index) => {
        const name = normalizedText(alias.name);
        if (!name) throw new Error(`第 ${index + 1} 个别名不能为空。`);
        if (!["ja", "zh"].includes(alias.language)) {
          throw new Error(`第 ${index + 1} 个别名的语言不合法。`);
        }
        const key = aliasKey(name);
        if (seen.has(key)) throw new Error(`别名“${name}”重复或与角色名称相同。`);
        seen.add(key);
        return {
          name,
          language: alias.language,
          source: normalizedText(alias.source) || "admin",
        };
      });
      const nextCharacters = state.characters.map((item, index) =>
        index === state.index ? { ...item, aliases } : item,
      );
      assertJapaneseNamesUnique(nextCharacters);
      await storageSet(DICTIONARY_STORAGE_KEY, dictionaryPayload(nextCharacters));
      state.characters = nextCharacters;
      cancelDiscovery();
      closeAliasEditor();
      const updated = currentCharacter();
      renderCharacterSummary(updated, state.decisions[updated.originalName]);
      renderPageCandidates();
      if (state.sheets.length) {
        const sheets = state.sheets.map((sheet) => ({
          url: sheet.url,
          sectionTitle: sheet.sectionTitle,
          alt: sheet.alt,
        }));
        state.sheets = prioritizeFaceSheets(sheets, updated);
        renderSheets();
      } else if (!state.selectedPage) {
        void discoverFirstFacePage(characterSearchTerms(updated));
      }
      elements.exportStatus.className = "viprpg-portrait-review-muted";
      elements.exportStatus.textContent = `已保存 ${updated.originalName} 的别名。`;
    } catch (error) {
      elements.aliasError.textContent = errorMessage(error);
    }
  }

  function aliasSourceLabel(source) {
    if (source === "base") return "基础表";
    if (source === "sub") return "补充表";
    return "人工";
  }

  function assertJapaneseNamesUnique(characters) {
    const owners = new Map();
    for (const character of characters) {
      owners.set(aliasKey(character.originalName), character.originalName);
    }
    for (const character of characters) {
      for (const alias of character.aliases) {
        if (alias.language !== "ja") continue;
        const existingOwner = owners.get(aliasKey(alias.name));
        if (existingOwner) {
          throw new Error(
            `日文别名“${alias.name}”已属于角色“${existingOwner}”。`,
          );
        }
        owners.set(aliasKey(alias.name), character.originalName);
      }
    }
  }

  function renderPageCandidates() {
    const character = currentCharacter();
    if (!character) {
      elements.pages.replaceChildren();
      return;
    }

    const query = elements.pageSearch.value;
    const candidates = pageCandidates(character, query).slice(0, 8);
    if (!candidates.length) {
      elements.pages.replaceChildren(
        messageNode(
          query
            ? "本地索引无匹配；按 Enter 搜索 atwiki。"
            : "正在从 atwiki 查找含脸图的页面…",
        ),
      );
      return;
    }

    elements.pages.replaceChildren(
      ...candidates.map(({ page }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "viprpg-portrait-review-button viprpg-portrait-review-page";
        button.dataset.active = String(page.url === state.selectedPage?.url);
        button.title = page.title;
        button.textContent = page.title;
        button.addEventListener("click", () => void selectPage(page));
        return button;
      }),
    );
  }

  async function selectPage(
    page,
    preferredSheetUrl = null,
    { fromDiscovery = false, sheets: prefetchedSheets = null } = {},
  ) {
    if (!fromDiscovery) cancelDiscovery();
    state.selectedPage = page;
    rememberPage(page);
    state.sheets = [];
    state.activeSheetUrl = null;
    if (!preferredSheetUrl) state.pending = null;
    const token = ++state.pageLoadToken;
    elements.sourcePage.href = page.url;
    elements.sourcePage.hidden = false;
    elements.pageStatus.className = "viprpg-portrait-review-muted";
    elements.pageStatus.textContent = `正在读取“${page.title}”的脸图…`;
    renderPageCandidates();
    renderSheets();
    renderGrid();

    try {
      const sheets =
        prefetchedSheets ??
        (await loadFaceSheets(page, currentCharacter(), undefined));
      if (token !== state.pageLoadToken) return;
      state.sheets = sheets;
      state.activeSheetUrl =
        sheets.find((sheet) => sheet.url === preferredSheetUrl)?.url ?? sheets[0]?.url ?? null;
      if (state.pending && !sheets.some((sheet) => sheet.url === state.pending.sourceImageUrl)) {
        state.pending = null;
      }
      const sectionCount = new Set(sheets.map((sheet) => sheet.sectionTitle)).size;
      elements.pageStatus.textContent = sheets.length
        ? `找到 ${sheets.length} 张脸图素材表，来自 ${sectionCount} 个分区。`
        : "该页的“顔グラ”区没有标准 192×192 素材表。";
      renderSheets();
      renderGrid();
    } catch (error) {
      if (token !== state.pageLoadToken) return;
      if (isAbortError(error)) return;
      elements.pageStatus.className = "viprpg-portrait-review-error";
      elements.pageStatus.textContent = `读取失败：${errorMessage(error)}`;
    }
  }

  async function discoverFirstFacePage(rawTerms) {
    const terms = [...new Set(rawTerms.map(normalizedText).filter(Boolean))];
    if (!terms.length) return;
    const { controller, token } = startDiscovery();
    const seenPages = new Set();

    try {
      for (const term of terms) {
        if (!isCurrentDiscovery(token)) return;
        elements.pages.replaceChildren(messageNode(`正在搜索 atwiki：${term}`));
        elements.pageStatus.className = "viprpg-portrait-review-muted";
        elements.pageStatus.textContent = `正在搜索角色“${term}”…`;
        const results = await searchAtwiki(term, controller.signal);
        if (!isCurrentDiscovery(token)) return;

        for (let index = 0; index < results.length; index += 1) {
          const page = results[index];
          if (seenPages.has(page.url)) continue;
          seenPages.add(page.url);
          elements.pageStatus.textContent = `正在检查搜索结果 ${index + 1} / ${results.length}：${page.title}`;
          let sheets;
          try {
            sheets = await loadFaceSheets(
              page,
              currentCharacter(),
              controller.signal,
            );
          } catch (error) {
            if (isAbortError(error)) throw error;
            console.warn(`[VIPRPG 角色头像确认] 跳过无法读取的搜索结果：${page.url}`, error);
            continue;
          }
          if (!isCurrentDiscovery(token)) return;
          if (!sheets.length) continue;

          state.discoveryController = null;
          await selectPage(page, null, { fromDiscovery: true, sheets });
          return;
        }
      }

      if (!isCurrentDiscovery(token)) return;
      state.discoveryController = null;
      elements.pages.replaceChildren(messageNode("atwiki 搜索没有找到含脸图的页面。"));
      elements.pageStatus.className = "viprpg-portrait-review-muted";
      elements.pageStatus.textContent = "可输入页面标题、#页码或完整 atwiki URL。";
    } catch (error) {
      if (!isCurrentDiscovery(token) || isAbortError(error)) return;
      state.discoveryController = null;
      elements.pages.replaceChildren(messageNode("atwiki 搜索失败。", true));
      elements.pageStatus.className = "viprpg-portrait-review-error";
      elements.pageStatus.textContent = `搜索失败：${errorMessage(error)}`;
    }
  }

  async function searchAtwiki(term, signal) {
    const key = normalizedKey(term);
    const cached = state.searchResultCache.get(key);
    if (cached) return cached;

    const request = atwikiSearchRequest(term);
    const response = await fetch(request.url, {
      body: request.body,
      cache: "no-store",
      credentials: "include",
      headers: request.headers,
      method: request.method,
      signal,
    });
    const responseText = await response.text();
    const documentFromSearch = new DOMParser().parseFromString(
      responseText,
      "text/html",
    );
    if (isAtwikiChallenge(documentFromSearch)) {
      throw new Error(
        "atwiki 要求安全验证。请先用页面顶部搜索框搜索一次，验证完成后重试。",
      );
    }
    if (!response.ok) throw new Error(`atwiki 搜索返回 HTTP ${response.status}。`);
    const pages = searchResultPages(documentFromSearch).slice(0, SEARCH_RESULT_LIMIT);
    state.searchResultCache.set(key, pages);
    return pages;
  }

  function atwikiSearchRequest(term) {
    const url = new URL("/viprpg_sozai/search", location.origin);
    url.searchParams.set("andor", "");
    url.searchParams.set("keyword", term);
    return {
      url: url.href,
      method: "GET",
      body: undefined,
      headers: undefined,
    };
  }

  function isAtwikiChallenge(documentFromSearch) {
    if (documentFromSearch.querySelector('script[src*="/cdn-cgi/challenge-platform/"]')) {
      return true;
    }
    const text = normalizedText(
      `${documentFromSearch.title} ${documentFromSearch.body?.textContent ?? ""}`,
    );
    return (
      /cloudflare/iu.test(text) &&
      /(ray id|安全验证|security verification|checking your browser|しばらくお待ち)/iu.test(text)
    );
  }

  function searchResultPages(documentFromSearch) {
    const root =
      documentFromSearch.querySelector("#wikibody") ??
      documentFromSearch.querySelector("main") ??
      documentFromSearch.body;
    if (!root) return [];
    const pages = [];
    const urls = new Set();
    for (const anchor of root.querySelectorAll("a[href]")) {
      const page = wikiPageFromLink(anchor);
      if (!page || page.url.endsWith(REVIEW_PAGE_PATH) || urls.has(page.url)) continue;
      urls.add(page.url);
      pages.push(page);
    }
    return pages;
  }

  async function loadFaceSheets(page, character, signal) {
    let sheets = state.faceSheetCache.get(page.url);
    if (!sheets) {
      const response = await fetch(page.url, {
        cache: "force-cache",
        credentials: "include",
        signal,
      });
      if (!response.ok) throw new Error(`素材页返回 HTTP ${response.status}。`);
      const documentFromPage = new DOMParser().parseFromString(
        await response.text(),
        "text/html",
      );
      sheets = findFaceSheets(documentFromPage);
      state.faceSheetCache.set(page.url, sheets);
    }
    return prioritizeFaceSheets(sheets, character);
  }

  function characterSearchTerms(character) {
    return [
      character.originalName,
      ...character.aliases
        .filter((alias) => alias.language === "ja")
        .map((alias) => alias.name),
    ];
  }

  function startDiscovery() {
    cancelDiscovery();
    const controller = new AbortController();
    state.discoveryController = controller;
    return { controller, token: state.discoveryToken };
  }

  function cancelDiscovery() {
    state.discoveryToken += 1;
    state.discoveryController?.abort();
    state.discoveryController = null;
  }

  function isCurrentDiscovery(token) {
    return token === state.discoveryToken;
  }

  function isAbortError(error) {
    return error instanceof DOMException && error.name === "AbortError";
  }

  function findFaceSheets(documentFromPage) {
    const body = documentFromPage.querySelector("#wikibody");
    if (!body) return [];
    const urls = new Set();
    const sheets = [];
    const headingStack = new Map();
    const headings = [...body.querySelectorAll("h2, h3, h4, h5, h6")];
    for (const heading of headings) {
      const level = Number(heading.tagName.slice(1));
      const title = normalizedText(heading.textContent);
      for (const knownLevel of [...headingStack.keys()]) {
        if (knownLevel >= level) headingStack.delete(knownLevel);
      }
      if (!/^顔グラ(?:フィック|素材)?$/u.test(title)) {
        if (title) headingStack.set(level, title);
        continue;
      }

      const sectionTitle =
        [...headingStack.entries()]
          .filter(([knownLevel]) => knownLevel < level)
          .sort((left, right) => right[0] - left[0])[0]?.[1] ?? "顔グラ";
      let node = heading.nextElementSibling;
      while (node) {
        if (/^H[2-6]$/u.test(node.tagName)) {
          const nextLevel = Number(node.tagName.slice(1));
          if (nextLevel <= level) break;
        }
        const images = node.matches("img") ? [node] : [...node.querySelectorAll("img")];
        for (const image of images) {
          const width = Number.parseInt(
            image.getAttribute("width") ?? image.style.width ?? "",
            10,
          );
          const height = Number.parseInt(
            image.getAttribute("height") ?? image.style.height ?? "",
            10,
          );
          const url = allowedImageUrl(
            image.getAttribute("src") ??
              image.getAttribute("data-src") ??
              image.getAttribute("data-original"),
          );
          if (
            width !== FACE_SHEET_SIZE ||
            height !== FACE_SHEET_SIZE ||
            !url ||
            urls.has(url)
          ) {
            continue;
          }
          urls.add(url);
          sheets.push({
            url,
            sectionTitle,
            alt: normalizedText(image.getAttribute("alt")) || filenameFromUrl(url),
          });
        }
        node = node.nextElementSibling;
      }
    }
    return sheets;
  }

  function prioritizeFaceSheets(sheets, character) {
    if (!character) return sheets;
    const names = [
      character.originalName,
      ...character.aliases
        .filter((alias) => alias.language === "ja")
        .map((alias) => alias.name),
    ]
      .map(normalizedKey)
      .filter(Boolean);
    return sheets
      .map((sheet, order) => ({
        ...sheet,
        matchScore: Math.min(
          ...names.map((name) =>
            Math.min(
              matchScore(normalizedKey(sheet.sectionTitle), name),
              matchScore(normalizedKey(sheet.alt), name),
            ),
          ),
        ),
        order,
      }))
      .sort((left, right) => left.matchScore - right.matchScore || left.order - right.order);
  }

  function renderSheets() {
    if (!state.sheets.length) {
      elements.sheets.replaceChildren();
      return;
    }

    const groups = new Map();
    for (const sheet of state.sheets) {
      const group = groups.get(sheet.sectionTitle) ?? [];
      group.push(sheet);
      groups.set(sheet.sectionTitle, group);
    }

    elements.sheets.replaceChildren(
      ...[...groups.entries()].map(([sectionTitle, sheets]) => {
        const group = document.createElement("section");
        group.className = "viprpg-portrait-review-sheet-group";
        const heading = document.createElement("div");
        heading.className = "viprpg-portrait-review-sheet-heading";
        heading.append(
          textElement("strong", sectionTitle),
          textElement(
            "span",
            `${sheets.length} 张${Number.isFinite(sheets[0].matchScore) ? " · 与当前角色匹配" : ""}`,
            "viprpg-portrait-review-muted",
          ),
        );
        const grid = document.createElement("div");
        grid.className = "viprpg-portrait-review-sheet-grid";
        grid.append(
          ...sheets.map((sheet, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "viprpg-portrait-review-sheet";
            button.dataset.active = String(sheet.url === state.activeSheetUrl);
            button.title = sheet.alt;
            const image = document.createElement("img");
            image.src = sheet.url;
            image.alt = `${index + 1}. ${sheet.alt}`;
            image.loading = "lazy";
            const label = textElement(
              "span",
              String(index + 1),
              "viprpg-portrait-review-muted",
            );
            button.append(image, label);
            button.addEventListener("click", () => {
              state.activeSheetUrl = sheet.url;
              if (state.pending?.sourceImageUrl !== sheet.url) state.pending = null;
              renderSheets();
              renderGrid();
            });
            return button;
          }),
        );
        group.append(heading, grid);
        return group;
      }),
    );
  }

  function renderGrid() {
    const sourceImageUrl = state.activeSheetUrl;
    elements.grid.hidden = !sourceImageUrl;
    elements.confirm.disabled = !state.pending;
    if (!sourceImageUrl) {
      elements.grid.replaceChildren();
      elements.grid.style.backgroundImage = "";
      renderPreview();
      return;
    }

    elements.grid.style.backgroundImage = cssUrl(sourceImageUrl);
    const cells = [];
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "viprpg-portrait-review-cell";
        cell.ariaLabel = `第 ${row + 1} 行，第 ${column + 1} 列`;
        cell.dataset.selected = String(
          state.pending?.sourceImageUrl === sourceImageUrl &&
            state.pending.row === row &&
            state.pending.column === column,
        );
        cell.addEventListener("click", () => {
          state.pending = { sourceImageUrl, row, column };
          renderGrid();
        });
        cells.push(cell);
      }
    }
    elements.grid.replaceChildren(...cells);
    renderPreview();
  }

  function renderPreview() {
    const pending = state.pending;
    elements.confirm.disabled = !pending || !state.selectedPage;
    if (!pending) {
      elements.selection.textContent = "尚未选择头像";
      return;
    }
    elements.selection.textContent = `第 ${pending.row + 1} 行，第 ${pending.column + 1} 列`;
  }

  async function confirmPortrait() {
    const character = currentCharacter();
    if (!character || !state.selectedPage || !state.pending) return;
    const sourceSheet = state.sheets.find(
      (sheet) => sheet.url === state.pending.sourceImageUrl,
    );
    state.decisions[character.originalName] = {
      status: "confirmed",
      sourcePageTitle: state.selectedPage.title,
      sourcePageUrl: state.selectedPage.url,
      sourceSectionTitle: sourceSheet?.sectionTitle ?? null,
      sourceImageUrl: state.pending.sourceImageUrl,
      row: state.pending.row,
      column: state.pending.column,
    };
    await saveProgress();
    showNextUnreviewed();
  }

  async function skipCharacter() {
    const character = currentCharacter();
    if (!character) return;
    state.decisions[character.originalName] = { status: "skipped" };
    await saveProgress();
    showNextUnreviewed();
  }

  async function saveProgress() {
    renderProgress();
    elements.exportPack.disabled = confirmedDecisions().length === 0;
    try {
      await storageSet(STORAGE_KEY, state.decisions);
      elements.exportStatus.className = "viprpg-portrait-review-muted";
      elements.exportStatus.textContent = "已保存当前确认进度。";
    } catch (error) {
      console.error("[VIPRPG 角色头像确认] 无法保存进度", error);
      elements.exportStatus.className = "viprpg-portrait-review-error";
      elements.exportStatus.textContent = "无法保存进度，请立即导出映射 JSON 备份。";
    }
  }

  function showNextUnreviewed() {
    if (!state.characters.length) return;
    for (let offset = 1; offset <= state.characters.length; offset += 1) {
      const index = (state.index + offset) % state.characters.length;
      if (!state.decisions[state.characters[index].originalName]) {
        showCharacter(index);
        return;
      }
    }
    showCharacter(state.index);
  }

  function renderProgress() {
    const confirmed = confirmedDecisions().length;
    const skipped = state.characters.filter(
      (character) => state.decisions[character.originalName]?.status === "skipped",
    ).length;
    const reviewed = confirmed + skipped;
    elements.progress.textContent = `${state.index + 1} / ${state.characters.length} · 已确认 ${confirmed} · 暂不设置 ${skipped} · 未处理 ${state.characters.length - reviewed}`;
  }

  function exportMapping() {
    if (!state.characters.length) return;
    downloadJson("viprpg-character-portrait-map.json", mappingPayload());
    elements.exportStatus.className = "viprpg-portrait-review-muted";
    elements.exportStatus.textContent = "已导出映射；其中保留原素材页与素材表来源。";
  }

  function exportDictionary() {
    if (!state.characters.length) return;
    downloadJson("character-dictionary.json", dictionaryPayload());
    elements.exportStatus.className = "viprpg-portrait-review-muted";
    elements.exportStatus.textContent = "已导出包含当前别名修改的角色字典。";
  }

  function dictionaryPayload(characters = state.characters) {
    return {
      schema: DICTIONARY_SCHEMA,
      characters: characters.map((character) => ({
        originalName: character.originalName,
        primaryName: character.primaryName,
        aliases: character.aliases.map((alias) => ({ ...alias })),
      })),
    };
  }

  async function exportPack() {
    if (state.exporting) return;
    const portraits = confirmedDecisions();
    if (!portraits.length) return;
    state.exporting = true;
    setExportButtonsDisabled(true);
    const imageCache = new Map();

    try {
      const packed = [];
      for (let index = 0; index < portraits.length; index += 1) {
        const portrait = portraits[index];
        elements.exportStatus.className = "viprpg-portrait-review-muted";
        elements.exportStatus.textContent = `正在裁切头像 ${index + 1} / ${portraits.length}：${portrait.originalName}`;
        let sourceDataUrl = imageCache.get(portrait.sourceImageUrl);
        if (!sourceDataUrl) {
          ({ dataUrl: sourceDataUrl } = await requestImage(portrait.sourceImageUrl));
          imageCache.set(portrait.sourceImageUrl, sourceDataUrl);
        }
        const portraitDataUrl = await cropPortrait(sourceDataUrl, portrait.row, portrait.column);
        packed.push({ name: portrait.filename, bytes: dataUrlBytes(portraitDataUrl) });
      }

      const mappingBytes = new TextEncoder().encode(
        `${JSON.stringify(mappingPayload(), null, 2)}\n`,
      );
      const dictionaryBytes = new TextEncoder().encode(
        `${JSON.stringify(dictionaryPayload(), null, 2)}\n`,
      );
      const zip = createStoredZip([
        ...packed,
        { name: "character-portrait-map.json", bytes: mappingBytes },
        { name: "character-dictionary.json", bytes: dictionaryBytes },
      ]);
      downloadBlob("viprpg-character-portrait-pack.zip", zip);
      elements.exportStatus.textContent = `已导出 ${packed.length} 张 PNG 头像、映射和角色字典。`;
    } catch (error) {
      console.error("[VIPRPG 角色头像确认] 导出失败", error);
      elements.exportStatus.className = "viprpg-portrait-review-error";
      elements.exportStatus.textContent = `导出失败：${errorMessage(error)}`;
    } finally {
      state.exporting = false;
      setExportButtonsDisabled(false);
    }
  }

  function mappingPayload() {
    const portraits = confirmedDecisions();
    const skippedOriginalNames = [];
    const unreviewedOriginalNames = [];
    for (const character of state.characters) {
      const decision = state.decisions[character.originalName];
      if (decision?.status === "skipped") skippedOriginalNames.push(character.originalName);
      else if (decision?.status !== "confirmed") unreviewedOriginalNames.push(character.originalName);
    }
    return {
      schema: MAPPING_SCHEMA,
      source: location.origin + "/viprpg_sozai/",
      portraits,
      skippedOriginalNames,
      unreviewedOriginalNames,
    };
  }

  function confirmedDecisions() {
    return state.characters.flatMap((character, index) => {
      const decision = state.decisions[character.originalName];
      if (decision?.status !== "confirmed") return [];
      return [
        {
          originalName: character.originalName,
          primaryName: character.primaryName,
          filename: `portraits/${String(index + 1).padStart(4, "0")}-${safeFilename(character.originalName)}.png`,
          sourcePageTitle: decision.sourcePageTitle,
          sourcePageUrl: decision.sourcePageUrl,
          sourceSectionTitle: decision.sourceSectionTitle ?? null,
          sourceImageUrl: decision.sourceImageUrl,
          row: decision.row,
          column: decision.column,
          crop: { x: decision.column * PORTRAIT_SIZE, y: decision.row * PORTRAIT_SIZE, width: 48, height: 48 },
        },
      ];
    });
  }

  function pageCandidates(character, rawQuery) {
    if (!character) return [];
    const directPage = pageFromInput(rawQuery);
    if (directPage) return [{ page: directPage, score: -1 }];
    const query = normalizedKey(rawQuery);
    const names = [
      character.originalName,
      ...character.aliases
        .filter((alias) => alias.language === "ja")
        .map((alias) => alias.name),
    ].map(normalizedKey).filter(Boolean);
    return allWikiPages()
      .map((page) => {
        const title = normalizedKey(page.title);
        const recentIndex = state.recentPages.findIndex(
          (candidate) => candidate.url === page.url,
        );
        const nameScore = Math.min(...names.map((name) => matchScore(title, name)));
        const score = query
          ? matchScore(title, query)
          : Number.isFinite(nameScore)
            ? nameScore
            : recentIndex >= 0
              ? 3 + recentIndex
              : Number.POSITIVE_INFINITY;
        return { page, score };
      })
      .filter(({ score }) => Number.isFinite(score))
      .sort((left, right) => left.score - right.score || compareText(left.page.title, right.page.title));
  }

  function allWikiPages() {
    const byUrl = new Map(state.pages.map((page) => [page.url, page]));
    for (const page of state.recentPages) byUrl.set(page.url, page);
    return [...byUrl.values()];
  }

  function pageFromInput(rawValue) {
    const value = normalizedText(rawValue);
    if (!value) return null;
    const pageId =
      value.match(/^#(\d+)$/u)?.[1] ??
      value.match(/(?:^|\/)pages\/(\d+)\.html(?:$|[?#])/u)?.[1];
    if (!pageId || pageId === "1") return null;
    const url = `https://w.atwiki.jp/viprpg_sozai/pages/${pageId}.html`;
    return (
      allWikiPages().find((page) => page.url === url) ??
      { title: `atwiki 页面 ${pageId}`, url }
    );
  }

  function rememberPage(page) {
    if (!isWikiPage(page)) return;
    state.recentPages = [
      page,
      ...state.recentPages.filter((candidate) => candidate.url !== page.url),
    ].slice(0, 4);
    void storageSet(RECENT_PAGES_STORAGE_KEY, state.recentPages).catch((error) => {
      console.error("[VIPRPG 角色头像确认] 无法保存最近素材页", error);
    });
  }

  function isWikiPage(value) {
    if (!value || typeof value !== "object") return false;
    if (!normalizedText(value.title) || typeof value.url !== "string") return false;
    try {
      const url = new URL(value.url);
      return (
        url.protocol === "https:" &&
        url.hostname === "w.atwiki.jp" &&
        /^\/viprpg_sozai\/pages\/\d+\.html$/u.test(url.pathname)
      );
    } catch {
      return false;
    }
  }

  function collectWikiPages() {
    const byUrl = new Map();
    for (const anchor of document.querySelectorAll('a[href*="/viprpg_sozai/pages/"]')) {
      const page = wikiPageFromLink(anchor);
      if (!page || page.url.endsWith(REVIEW_PAGE_PATH)) continue;
      const existing = byUrl.get(page.url);
      if (!existing || page.title.length < existing.title.length) {
        byUrl.set(page.url, page);
      }
    }
    return [...byUrl.values()].sort((left, right) => compareText(left.title, right.title));
  }

  function wikiPageFromLink(anchor) {
    const title = normalizedText(anchor.textContent);
    if (!title) return null;
    try {
      const url = new URL(anchor.getAttribute("href") ?? "", location.href);
      if (url.protocol !== "https:" || url.hostname !== "w.atwiki.jp") return null;
      const pageId =
        url.pathname.match(/^\/viprpg_sozai\/pages\/(\d+)\.html$/u)?.[1] ??
        (url.pathname === "/viprpg_sozai/" && url.searchParams.get("cmd") === "word"
          ? url.searchParams.get("pageid")?.match(/^\d+$/u)?.[0]
          : null);
      if (!pageId) return null;
      return {
        title,
        url: `https://w.atwiki.jp/viprpg_sozai/pages/${pageId}.html`,
      };
    } catch {
      return null;
    }
  }

  function matchScore(left, right) {
    if (!left || !right) return Number.POSITIVE_INFINITY;
    if (left === right) return 0;
    if (left.startsWith(right) || right.startsWith(left)) return 1;
    if (left.includes(right) || right.includes(left)) return 2;
    return Number.POSITIVE_INFINITY;
  }

  function allowedImageUrl(rawUrl) {
    if (!rawUrl) return null;
    try {
      const url = new URL(rawUrl, location.href);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "img.atwiki.jp" ||
        !url.pathname.startsWith("/viprpg_sozai/attach/")
      ) {
        return null;
      }
      return url.href;
    } catch {
      return null;
    }
  }

  function requestImage(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: FETCH_IMAGE_MESSAGE, url }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.ok || typeof response.dataUrl !== "string") {
          reject(new Error(response?.error || "无法读取图片。"));
          return;
        }
        resolve(response);
      });
    });
  }

  async function cropPortrait(sourceDataUrl, row, column) {
    const sourceImage = await loadImage(sourceDataUrl);
    if (sourceImage.naturalWidth !== FACE_SHEET_SIZE || sourceImage.naturalHeight !== FACE_SHEET_SIZE) {
      throw new Error("素材表不是 192×192 图片。 ");
    }
    const canvas = document.createElement("canvas");
    canvas.width = PORTRAIT_SIZE;
    canvas.height = PORTRAIT_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法创建裁切画布。");
    context.imageSmoothingEnabled = false;
    context.drawImage(
      sourceImage,
      column * PORTRAIT_SIZE,
      row * PORTRAIT_SIZE,
      PORTRAIT_SIZE,
      PORTRAIT_SIZE,
      0,
      0,
      PORTRAIT_SIZE,
      PORTRAIT_SIZE,
    );
    return canvas.toDataURL("image/png");
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.addEventListener("load", () => resolve(image), { once: true });
      image.addEventListener("error", () => reject(new Error("图片解码失败。")), { once: true });
      image.src = dataUrl;
    });
  }

  function downloadJson(filename, value) {
    const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
    downloadBlob(filename, blob);
  }

  function downloadBlob(filename, blob) {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.hidden = true;
    (document.body || document.documentElement).append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  }

  function dataUrlBytes(dataUrl) {
    const separator = dataUrl.indexOf(",");
    if (separator < 0 || !dataUrl.slice(0, separator).endsWith(";base64")) {
      throw new Error("裁切后的头像不是有效 PNG 数据。");
    }
    const binary = atob(dataUrl.slice(separator + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function createStoredZip(entries) {
    if (entries.length > 65_535) throw new Error("头像包文件数量超过 ZIP 限制。");
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
      const name = encoder.encode(entry.name);
      const bytes = entry.bytes;
      const checksum = crc32(bytes);
      const localHeader = new Uint8Array(30 + name.length);
      const localView = new DataView(localHeader.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint32(14, checksum, true);
      localView.setUint32(18, bytes.length, true);
      localView.setUint32(22, bytes.length, true);
      localView.setUint16(26, name.length, true);
      localHeader.set(name, 30);

      const centralHeader = new Uint8Array(46 + name.length);
      const centralView = new DataView(centralHeader.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint32(16, checksum, true);
      centralView.setUint32(20, bytes.length, true);
      centralView.setUint32(24, bytes.length, true);
      centralView.setUint16(28, name.length, true);
      centralView.setUint32(42, offset, true);
      centralHeader.set(name, 46);

      localParts.push(localHeader, bytes);
      centralParts.push(centralHeader);
      offset += localHeader.length + bytes.length;
    }

    const centralSize = centralParts.reduce((sum, value) => sum + value.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, offset, true);
    return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
  }

  function crc32(bytes) {
    let value = 0xffffffff;
    for (const byte of bytes) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
      }
    }
    return (value ^ 0xffffffff) >>> 0;
  }

  function storageGet(key) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(key, (items) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(items[key]);
      });
    });
  }

  function storageSet(key, value) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  }

  function setExportButtonsDisabled(disabled) {
    elements.exportDictionary.disabled = disabled || !state.characters.length;
    elements.exportMap.disabled = disabled || !state.characters.length;
    elements.exportPack.disabled = disabled || confirmedDecisions().length === 0;
  }

  function disableReviewControls() {
    for (const element of [
      elements.jump,
      elements.previous,
      elements.next,
      elements.nextUnreviewed,
      elements.editAliases,
      elements.pageSearch,
      elements.confirm,
      elements.skip,
      elements.exportDictionary,
      elements.exportMap,
      elements.exportPack,
    ]) {
      element.disabled = true;
    }
  }

  function closeReview() {
    cancelDiscovery();
    closeAliasEditor();
    review.hidden = true;
    launchButton.focus();
  }

  function currentCharacter() {
    return state.characters[state.index] ?? null;
  }

  function normalizedText(value) {
    return String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ");
  }

  function normalizedKey(value) {
    return normalizedText(value)
      .toLocaleLowerCase("ja")
      .replace(/[\s\u3000・･:：()（）\[\]［］【】/／_＿-]+/gu, "");
  }

  function aliasKey(value) {
    return normalizedText(value).toLowerCase();
  }

  function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
  }

  function safeFilename(value) {
    return (
      normalizedText(value)
        .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_")
        .replace(/[.\s]+$/gu, "")
        .slice(0, 100) || "character"
    );
  }

  function filenameFromUrl(url) {
    const raw = new URL(url).pathname.split("/").pop() || "脸图素材";
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  function cssUrl(url) {
    return `url(${JSON.stringify(url)})`;
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : "发生未知错误。";
  }

  function textElement(tagName, text, className = "") {
    const element = document.createElement(tagName);
    element.className = className;
    element.textContent = text;
    return element;
  }

  function messageNode(text, error = false) {
    return textElement(
      "div",
      text,
      error ? "viprpg-portrait-review-error" : "viprpg-portrait-review-muted",
    );
  }

  function requiredElement(id, constructor) {
    const element = review.querySelector(`#${id}`);
    if (!(element instanceof constructor)) throw new Error(`缺少头像确认界面元素：${id}`);
    return element;
  }
})();
