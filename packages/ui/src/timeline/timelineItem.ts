// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument, INode } from "@chili3d/core";
import { TreeItem } from "../project/tree/treeItem";
import style from "./timelineItem.module.css";

/** One entry in the timeline strip - reuses TreeItem's name binding and visibility toggle. */
export class TimelineItem extends TreeItem {
    constructor(document: IDocument, node: INode) {
        super(document, node);
        this.append(this.name, this.visibleIcon);
        this.classList.add(style.chip);
    }

    mainElement(): HTMLElement {
        return this;
    }
}

customElements.define("timeline-item", TimelineItem);
