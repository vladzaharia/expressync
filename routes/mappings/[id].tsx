import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { eq } from "drizzle-orm";
import MappingForm from "../../islands/MappingForm.tsx";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/card.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const id = parseInt(ctx.params.id);
    const [mapping] = await db
      .select()
      .from(schema.userMappings)
      .where(eq(schema.userMappings.id, id));

    if (!mapping) {
      return new Response("Mapping not found", { status: 404 });
    }

    return { data: { mapping } };
  },
});

export default define.page<typeof handler>(function EditMappingPage({ data, url }) {
  return (
    <SidebarLayout
      currentPath={url.pathname}
      title="Edit Mapping"
      description={`Editing mapping for ${data.mapping.steveOcppIdTag}`}
    >
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Mapping Details</CardTitle>
          <CardDescription>
            Update the OCPP tag and Lago customer information.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MappingForm mapping={data.mapping} />
        </CardContent>
      </Card>
    </SidebarLayout>
  );
});

