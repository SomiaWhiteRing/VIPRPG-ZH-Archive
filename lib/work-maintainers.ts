export type MaintainerUser = { id: number; displayName: string; avatarBlobSha256: string | null };
export type MaintainerRequestStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'closed';
export type MaintainerApplication = {
  recipients: MaintainerUser[];
  request: { id: number; status: MaintainerRequestStatus; inboxItemId: number } | null;
  canApply: boolean;
  unavailableReason: string | null;
};
