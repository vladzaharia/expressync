import { define } from "../../utils.ts";
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
  GET(_ctx) {
    return { data: {} };
  },
});

export default define.page<typeof handler>(
  function NewTagLinkingPage({ url, state }) {
    return (
      <SidebarLayout
        currentPath={url.pathname}
        title="Link Tags"
        description="Create a new link between OCPP tags and a Lago customer"
        user={state.user}
      >
        <Card>
          <CardHeader>
            <CardTitle>New Tag Link</CardTitle>
            <CardDescription>
              Select an OCPP tag and link it to a Lago customer and subscription.
              Child tags will automatically inherit the parent's billing configuration.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MappingForm />
          </CardContent>
        </Card>
      </SidebarLayout>
    );
  },
);

