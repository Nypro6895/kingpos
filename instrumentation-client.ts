if (process.env.NODE_ENV === "development") {
  const isExtensionHydrationAttribute = (attributeName: string) =>
    attributeName === "bis_skin_checked" ||
    attributeName === "bis_register" ||
    /^__processed_[\w-]+__$/.test(attributeName);

  const removeExtensionHydrationAttributesFromElement = (element: Element) => {
    for (const attribute of Array.from(element.attributes)) {
      if (isExtensionHydrationAttribute(attribute.name)) {
        element.removeAttribute(attribute.name);
      }
    }
  };

  const removeExtensionHydrationAttributes = (root: ParentNode) => {
    if (root instanceof Element) {
      removeExtensionHydrationAttributesFromElement(root);
    }

    root
      .querySelectorAll("*")
      .forEach(removeExtensionHydrationAttributesFromElement);
  };

  removeExtensionHydrationAttributes(document);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes" && mutation.target instanceof Element) {
        const attributeName = mutation.attributeName;

        if (attributeName && isExtensionHydrationAttribute(attributeName)) {
          mutation.target.removeAttribute(attributeName);
        }

        continue;
      }

      for (const node of mutation.addedNodes) {
        if (node instanceof Element) {
          removeExtensionHydrationAttributes(node);
        }
      }
    }
  });

  observer.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
  });

  window.setTimeout(() => observer.disconnect(), 5000);
}
