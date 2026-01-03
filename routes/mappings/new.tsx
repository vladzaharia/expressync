import { define } from "../../utils.ts";
import MappingForm from "../../islands/MappingForm.tsx";

export default define.page(function NewMappingPage() {
  return (
    <div class="container mx-auto px-4 py-8">
      <h1 class="text-2xl font-bold mb-6">Create New Mapping</h1>

      <div class="bg-white shadow rounded-lg p-6">
        <MappingForm />
      </div>
    </div>
  );
});

