import { useEffect } from "preact/hooks";

interface PageTitleProps {
  title: string;
  description?: string;
  image?: string;
}

/**
 * PageTitle island - sets document.title and OG meta tags on mount.
 *
 * Fresh 2 lacks per-route head injection, so we update the DOM client-side.
 */
export default function PageTitle(
  { title, description, image }: PageTitleProps,
) {
  useEffect(() => {
    const fullTitle = `${title} — ExpressCharge`;
    document.title = fullTitle;

    const setMeta = (
      name: string,
      content: string,
      attr: "name" | "property" = "property",
    ) => {
      if (!content) return;
      let el = document.querySelector(
        `meta[${attr}="${name}"]`,
      ) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      el.content = content;
    };

    setMeta("og:title", fullTitle);
    if (description) setMeta("og:description", description);
    if (image) setMeta("og:image", image);
  }, [title, description, image]);

  return null;
}
