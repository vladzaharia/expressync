import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.tsx";
import MappingForm from "../../islands/MappingForm.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const id = parseInt(ctx.params.id);
    if (isNaN(id)) {
      return ctx.redirect("/tag-linking");
    }

    const [mapping] = await db
      .select()
      .from(schema.userMappings)
      .where(eq(schema.userMappings.id, id))
      .limit(1);

    if (!mapping) {
      return ctx.redirect("/tag-linking");
    }

    return { data: { mapping } };
  },
});

export default define.page<typeof handler>(
  function EditTagLinkingPage({ data, url, state }) {
    return (
      <SidebarLayout
        currentPath={url.pathname}
        title="Edit Tag Link"
        description="Update the link between an OCPP tag and Lago customer"
        user={state.user}
      >
        <Card>
          <CardHeader>
            <CardTitle>Edit Tag Link</CardTitle>
            <CardDescription>
              Update the billing configuration for this OCPP tag.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MappingForm mapping={data.mapping} />
          </CardContent>
        </Card>
      </SidebarLayout>
    );
  },
);

