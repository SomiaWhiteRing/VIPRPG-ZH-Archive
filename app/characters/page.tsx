import { getCurrentUser } from "@/app/.server/auth/current-user";
import { readCharacterIndex } from "@/app/.server/db/character-index";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { CharacterIndexBrowser } from "@/app/characters/character-index-browser";
import { buttonVariants } from "@/app/components/ui/button";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import {
  CHARACTER_EDIT_PERMISSIONS,
  CHARACTER_INDEX_PERMISSIONS,
  hasPermission,
} from "@/lib/authz/permissions";
import { formatNumber } from "@/lib/format";
import { stringParam } from "@/lib/params";
import type { PageMetadata } from "@/lib/ui/page-metadata";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { FolderPen } from "lucide-react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

const metadata: PageMetadata = {
  title: "角色索引",
  description:
    "按阵营与角色群浏览 VIPRPG 角色，查找中日文名称、别名、Wiki 资料与登场作品。",
};

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const params = await searchParams;
  const query = stringParam(params.q).trim();
  const [data, currentUser] = await Promise.all([
    readCharacterIndex(runtime),
    getCurrentUser(runtime),
  ]);
  const canEdit = CHARACTER_EDIT_PERMISSIONS.some((permission) =>
    hasPermission(currentUser, permission),
  );
  const canEditIndex = CHARACTER_INDEX_PERMISSIONS.some((permission) =>
    hasPermission(currentUser, permission),
  );

  return { query, data, canEdit, canEditIndex };
}

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors(metadata, error);

export default function CharactersPage() {
  const { query, data, canEdit, canEditIndex } = useLoaderData<typeof loader>();
  return (
    <PageContainer>
      <PageHeader
        compact
        title="角色索引"
        actions={
          <>
            <span className="text-sm text-muted">
              收录{" "}
              <strong className="tabular-nums text-foreground">
                {formatNumber(data.characters.length)}
              </strong>{" "}
              位角色
            </span>
            {canEditIndex ? (
              <Link
                aria-label="编辑角色索引"
                className={buttonVariants({ variant: "ghost", size: "icon" })}
                to="/admin/characters/index"
                prefetch="none"
                title="编辑角色索引"
              >
                <FolderPen aria-hidden />
              </Link>
            ) : null}
          </>
        }
      />

      <div className="mt-5">
        <CharacterIndexBrowser
          canEdit={canEdit}
          canEditIndex={canEditIndex}
          data={data}
          initialQuery={query}
          key={query}
        />
      </div>
    </PageContainer>
  );
}
