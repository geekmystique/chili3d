// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command } from "@chili3d/core";
import { ThickSolidNode } from "../../bodys/thickSolid";
import { singleSectionEditOf } from "./singleSectionEditMixin";

/**
 * Re-picks the section (and/or sub-shape within it) of an existing
 * ThickSolidNode, updating it in place instead of creating a new feature -
 * so anything downstream that references it keeps working. Operates on the
 * node currently selected in the tree/timeline; invoked by double-clicking
 * that entry. thickness stays independently editable through the node's own
 * Properties panel, so it isn't touched here.
 */
@command({
    key: "modify.thickSolidEdit",
    icon: "icon-thickSolid",
})
export class ThickSolidEditCommand extends singleSectionEditOf(ThickSolidNode) {}
