export const INBOX_CHANGED_EVENT = "inbox:changed";

export function notifyInboxChanged() {
  window.dispatchEvent(new Event(INBOX_CHANGED_EVENT));
}
