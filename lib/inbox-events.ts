export const INBOX_CHANGED_EVENT = "inbox:changed";

export function notifyInboxChanged(message?: string) {
  window.dispatchEvent(new CustomEvent(INBOX_CHANGED_EVENT, { detail: message }));
}
