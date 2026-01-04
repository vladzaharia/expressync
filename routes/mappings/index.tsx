import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import MappingsTable from "../../islands/MappingsTable.tsx";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Plus } from "lucide-preact";

export const handler = define.handlers({
  async GET(ctx) {
    const mappings = await db.select().from(schema.userMappings);
    return { data: { mappings } };
  },
});

export default define.page<typeof handler>(
  function MappingsPage({ data, url, state }) {
    return (
      <SidebarLayout
        currentPath={url.pathname}
        title="OCPP Tag Mappings"
        description="Manage mappings between OCPP tags and Lago billing customers"
        user={state.user}
        actions={
          <Button asChild>
            <a href="/mappings/new">
              <Plus className="size-4 mr-2" />
              Add Mapping
            </a>
          </Button>
        }
      >
        <Card>
          <CardHeader>
            <CardTitle>All Mappings</CardTitle>
            <CardDescription>
              {data.mappings.length}{" "}
              mapping{data.mappings.length !== 1 ? "s" : ""} configured
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MappingsTable mappings={data.mappings} />
          </CardContent>
        </Card>
      </SidebarLayout>
    );
  },
);
