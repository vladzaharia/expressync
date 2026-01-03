import { define } from "../../utils.ts";
import MappingForm from "../../islands/MappingForm.tsx";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/card.tsx";

export default define.page(function NewMappingPage({ url }) {
  return (
    <SidebarLayout
      currentPath={url.pathname}
      title="Create New Mapping"
      description="Link an OCPP tag to a Lago billing customer"
    >
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Mapping Details</CardTitle>
          <CardDescription>
            Enter the OCPP tag and Lago customer information to create a new billing mapping.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MappingForm />
        </CardContent>
      </Card>
    </SidebarLayout>
  );
});

