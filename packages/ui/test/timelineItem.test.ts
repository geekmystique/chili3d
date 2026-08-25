// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { INode } from "@chili3d/core";
// test-utils must load BEFORE the core-mock helper so the real core module is
// fully cached by the time `rs.mock("@chili3d/core")` registers.
import { createMockDocument } from "@chili3d/core/test-utils";
import { describe, expect, rs, test } from "@rstest/core";

// CSS modules under test
rs.mock("../src/project/tree/treeItem.module.css", () => ({
    name: "tri-name",
    icon: "tri-icon",
    "parent-hidden": "tri-parent-hidden",
}));

rs.mock("../src/timeline/timelineItem.module.css", () => ({
    chip: "ti-chip",
}));

// Mock core: no-op Binding, immediate Transaction
import "./_helpers/mockCoreBinding";

// Mock element helpers
import "./_helpers/mockElement";

import { TimelineItem } from "../src/timeline/timelineItem";

class MockNode {
    name = "Box";
    visible = true;
    parentVisible = true;
    onPropertyChanged() {}
    removePropertyChanged() {}
}

describe("TimelineItem", () => {
    function createItem() {
        const node = new MockNode();
        const doc = createMockDocument();
        return { item: new TimelineItem(doc, node as unknown as INode), node };
    }

    test("should append name and visible icon with the chip class", () => {
        const { item } = createItem();
        expect(item.classList.contains("ti-chip")).toBe(true);
        expect(item.children[0]).toBe(item.name);
        expect(item.children[1]).toBe(item.visibleIcon);
    });

    test("should render the name label and visible icon (inherited from TreeItem)", () => {
        const { item } = createItem();
        expect(item.name.tagName).toBe("LABEL");
        expect(item.visibleIcon.getAttribute("icon")).toBe("icon-eye");
    });

    test("mainElement should return itself", () => {
        const { item } = createItem();
        expect(item.mainElement()).toBe(item);
    });
});
