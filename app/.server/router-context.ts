import { createContext } from "react-router";
import type { AppRuntime } from "./runtime";

export const runtimeContext = createContext<AppRuntime>();
