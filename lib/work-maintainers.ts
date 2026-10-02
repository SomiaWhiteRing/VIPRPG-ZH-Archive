export type MaintainerUser = { id: number; displayName: string; avatarBlobSha256: string | null };
export type MaintainerRequestStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'closed';
export type MaintainerApplication = {
  recipients: MaintainerUser[];
  request: { id: number; status: MaintainerRequestStatus; inboxItemId: number } | null;
  canApply: boolean;
  unavailableReason: string | null;
};

export const MAINTAINER_APPLICATION_DESCRIPTION = '申请通过后，你将获得这部作品的维护权限：修改作品资料、管理文件和外链、隐藏或删除作品，以及添加其他维护者。';

export const MAINTAINER_GRANT_DESCRIPTION = '加入后，对方将与你平级，共同维护这部作品。移除维护者只有具有管理员权限的账户才能处理。\n\n对方同样可以修改作品资料、管理归档和外链、隐藏或删除作品，以及添加其他维护者。';
