import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { eq } from "drizzle-orm";
import MappingForm from "../../islands/MappingForm.tsx";

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

export default define.page<typeof handler>(function EditMappingPage({ data }) {
  return (
    <div class="container mx-auto px-4 py-8">
      <h1 class="text-2xl font-bold mb-6">Edit Mapping</h1>

      <div class="bg-white shadow rounded-lg p-6">
        <MappingForm mapping={data.mapping} />
      </div>
    </div>
  );
});

