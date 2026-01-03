import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import MappingsTable from "../../islands/MappingsTable.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const mappings = await db.select().from(schema.userMappings);
    return { data: { mappings } };
  },
});

export default define.page<typeof handler>(function MappingsPage({ data }) {
  return (
    <div class="container mx-auto px-4 py-8">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold">OCPP Tag Mappings</h1>
        <a
          href="/mappings/new"
          class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Add Mapping
        </a>
      </div>

      <MappingsTable mappings={data.mappings} />
    </div>
  );
});

