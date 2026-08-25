// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    GeometryNode,
    type IDocument,
    type INode,
    type INodeLinkedList,
    type NodeRecord,
} from "@chili3d/core";
import { TimelineItem } from "./timelineItem";
import style from "./timelineTrack.module.css";

/**
 * One document's timeline strip: a flat, left-to-right list of every
 * GeometryNode (body/feature) in the document, in tree order. Tree order
 * approximates creation order for a document that hasn't been manually
 * reorganized - there is no separate, explicit creation-order record yet.
 * Reordering the project tree does not reorder this strip.
 */
export class TimelineTrack extends HTMLElement {
    private readonly nodeMap = new Map<GeometryNode, TimelineItem>();

    constructor(private document: IDocument) {
        super();
        this.className = style.track;
        this.collectExisting(document.modelManager.rootNode).forEach((node) => {
            this.addItem(node);
        });
    }

    connectedCallback(): void {
        this.document.modelManager.addNodeObserver(this.handleNodeChanged);
        this.document.selection.onNodeChanged.sub(this.handleSelectionChanged);
        this.addEventListener("click", this.onClick);
    }

    disconnectedCallback(): void {
        this.document.modelManager.removeNodeObserver(this.handleNodeChanged);
        this.document.selection.onNodeChanged.remove(this.handleSelectionChanged);
        this.removeEventListener("click", this.onClick);
    }

    dispose(): void {
        this.nodeMap.forEach((item) => {
            item.dispose();
        });
        this.nodeMap.clear();
        this.document.modelManager.removeNodeObserver(this.handleNodeChanged);
        this.document.selection.onNodeChanged.remove(this.handleSelectionChanged);
        this.document = null as any;
    }

    private collectExisting(node: INode, result: GeometryNode[] = []): GeometryNode[] {
        if (node instanceof GeometryNode) result.push(node);
        const firstChild = (node as INodeLinkedList).firstChild;
        if (firstChild) this.collectExisting(firstChild, result);
        if (node.nextSibling) this.collectExisting(node.nextSibling, result);
        return result;
    }

    private addItem(node: GeometryNode) {
        if (this.nodeMap.has(node)) return;
        const item = new TimelineItem(this.document, node);
        this.nodeMap.set(node, item);
        this.append(item);
    }

    private removeItem(node: GeometryNode) {
        const item = this.nodeMap.get(node);
        if (!item) return;
        item.dispose();
        this.nodeMap.delete(node);
    }

    private readonly handleNodeChanged = (records: NodeRecord[]) => {
        records.forEach((record) => {
            if (!(record.node instanceof GeometryNode)) return;
            if (record.newParent) {
                this.addItem(record.node);
            } else {
                this.removeItem(record.node);
            }
        });
    };

    private readonly handleSelectionChanged = (selected: INode[]) => {
        this.nodeMap.forEach((item, node) => {
            if (selected.includes(node)) {
                item.addStyle(style.selected);
            } else {
                item.removeStyle(style.selected);
            }
        });
        const node = selected.find((n) => this.nodeMap.has(n as GeometryNode));
        if (node) {
            this.nodeMap.get(node as GeometryNode)?.scrollIntoView({ inline: "nearest", behavior: "smooth" });
        }
    };

    private readonly onClick = (event: MouseEvent) => {
        const item = this.getTimelineItem(event.target as HTMLElement | null);
        if (!item) return;
        this.document.selection.setSelectedNodes([item.node], event.ctrlKey);
    };

    private getTimelineItem(el: HTMLElement | null): TimelineItem | undefined {
        if (!el) return undefined;
        if (el instanceof TimelineItem) return el;
        return this.getTimelineItem(el.parentElement);
    }
}

customElements.define("ui-timeline-track", TimelineTrack);
