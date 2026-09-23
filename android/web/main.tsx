import { createRoot } from "react-dom/client";
import { OfflineApp } from "./offline-app";
import "./styles.css";
import "./offline.css";

createRoot(document.getElementById("root")!).render(<OfflineApp />);
