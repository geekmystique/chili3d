// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    GeometryNode,
    type IDocument,
    type INode,
    type INodeLinkedList,
    Localize,
    type NodeRecord,
    PubSub,
    ReferenceShapeNode,
    removeFromReferenceChain,
    Transaction,
} from "@chili3d/core";
import { div, label } from "@chili3d/element";
import { DropdownController } from "../ribbon/dropdownController";
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
    private readonly contextMenu = new DropdownController(style.contextMenu);

    /** The node currently "rolled back" to, and every node after it that got forced hidden for the preview. */
    private previewedNode: GeometryNode | undefined;
    private previewHiddenNodes: GeometryNode[] = [];

    constructor(private document: IDocument) {
        super();
        this.className = style.track;
        this.collectExisting(document.modelManager.rootNode).forEach((node) => {
            this.addItem(node);
        });
        this.reorderToMatchTree();
    }

    connectedCallback(): void {
        this.document.modelManager.addNodeObserver(this.handleNodeChanged);
        this.document.selection.onNodeChanged.sub(this.handleSelectionChanged);
        PubSub.default.sub("closeCommandContext", this.restorePreview);
        this.addEventListener("click", this.onClick);
        this.addEventListener("dblclick", this.onDoubleClick);
        this.addEventListener("contextmenu", this.onContextMenu);
    }

    disconnectedCallback(): void {
        this.document.modelManager.removeNodeObserver(this.handleNodeChanged);
        this.document.selection.onNodeChanged.remove(this.handleSelectionChanged);
        PubSub.default.remove("closeCommandContext", this.restorePreview);
        this.removeEventListener("click", this.onClick);
        this.removeEventListener("dblclick", this.onDoubleClick);
        this.removeEventListener("contextmenu", this.onContextMenu);
    }

    dispose(): void {
        this.restorePreview();
        PubSub.default.remove("closeCommandContext", this.restorePreview);
        this.contextMenu.dispose();
        this.nodeMap.forEach((item) => {
            item.dispose();
        });
        this.nodeMap.clear();
        this.document.modelManager.removeNodeObserver(this.handleNodeChanged);
        this.document.selection.onNodeChanged.remove(this.handleSelectionChanged);
        this.document = null as any;
    }

    /**
     * Roll the 3D view back to how it looked right after `node` was computed:
     * `node` itself is shown (even if something later in the chain normally
     * keeps it hidden), and everything after it in tree order is hidden -
     * whatever `node`'s own downstream would have looked like at that point
     * in the timeline hasn't happened yet. Selecting a different node (or an
     * edit/structural change completing - see restorePreview) replaces or
     * clears this; it never touches node.visible itself, so it can't create
     * undo history or survive a reload.
     */
    private readonly previewAt = (node: GeometryNode) => {
        this.restorePreview();

        const order = this.collectExisting(this.document.modelManager.rootNode);
        const index = order.indexOf(node);
        if (index === -1) return;

        const context = this.document.visual.context;
        context.setVisible(node, node.parentVisible);

        const after = order.slice(index + 1);
        after.forEach((n) => {
            context.setVisible(n, false);
        });

        this.previewedNode = node;
        this.previewHiddenNodes = after;
    };

    /** Drop the rollback preview, if any, and re-render every node it touched at its real visibility. */
    private readonly restorePreview = () => {
        if (!this.previewedNode) return;
        const context = this.document.visual.context;
        const restore = (n: GeometryNode) => context.setVisible(n, n.visible && n.parentVisible);
        restore(this.previewedNode);
        this.previewHiddenNodes.forEach(restore);
        this.previewedNode = undefined;
        this.previewHiddenNodes = [];
    };

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
    }

    private removeItem(node: GeometryNode) {
        const item = this.nodeMap.get(node);
        if (!item) return;
        item.dispose();
        this.nodeMap.delete(node);
    }

    private readonly handleNodeChanged = (records: NodeRecord[]) => {
        this.restorePreview();
        records.forEach((record) => {
            if (!(record.node instanceof GeometryNode)) return;
            if (record.newParent) {
                this.addItem(record.node);
            } else {
                this.removeItem(record.node);
            }
        });
        this.reorderToMatchTree();
    };

    /**
     * DOM append() moves an already-attached element rather than duplicating
     * it, so walking every known item in tree order and re-appending it is
     * an O(n) way to keep the strip's visual order in sync with the tree -
     * needed because add/insertAfter/move can land a node anywhere, not just
     * at the end.
     */
    private reorderToMatchTree(): void {
        this.collectExisting(this.document.modelManager.rootNode).forEach((node) => {
            const item = this.nodeMap.get(node);
            if (item) this.append(item);
        });
    }

    private readonly handleSelectionChanged = (selected: INode[]) => {
        const related = this.collectRelatedIds(selected);
        this.nodeMap.forEach((item, node) => {
            if (selected.includes(node)) {
                item.addStyle(style.selected);
                item.removeStyle(style.related);
            } else {
                item.removeStyle(style.selected);
                if (related.has(node.id)) {
                    item.addStyle(style.related);
                } else {
                    item.removeStyle(style.related);
                }
            }
        });
        const node = selected.find((n) => this.nodeMap.has(n as GeometryNode));
        if (node) {
            this.nodeMap.get(node as GeometryNode)?.scrollIntoView({ inline: "nearest", behavior: "smooth" });
        }
    };

    /** Every node transitively upstream or downstream of any selected node, via the DependencyGraph. */
    private collectRelatedIds(selected: INode[]): Set<string> {
        const graph = this.document.modelManager.dependencyGraph;
        const related = new Set<string>();
        if (!graph) return related;
        selected.forEach((node) => {
            graph.getAllDependencies(node.id).forEach((id) => {
                related.add(id);
            });
            graph.getAllDependents(node.id).forEach((id) => {
                related.add(id);
            });
        });
        return related;
    }

    private readonly onClick = (event: MouseEvent) => {
        const item = this.getTimelineItem(event.target as HTMLElement | null);
        if (!item) return;
        this.document.selection.setSelectedNodes([item.node], event.ctrlKey);
        // A plain click previews that point in the timeline; ctrl-click builds a
        // multi-selection, which has no single "point in time" to roll back to.
        if (!event.ctrlKey && item.node instanceof GeometryNode) this.previewAt(item.node);
    };

    /** Double-clicking a feature that declares an editCommandKey re-opens its re-pick flow. */
    private readonly onDoubleClick = (event: MouseEvent) => {
        const item = this.getTimelineItem(event.target as HTMLElement | null);
        if (!item) return;
        const node = item.node;
        if (!(node instanceof ReferenceShapeNode)) return;
        const commandKey = node.editCommandKey;
        if (!commandKey) return;
        this.document.selection.setSelectedNodes([node], false);
        this.previewAt(node);
        PubSub.default.pub("executeCommand", commandKey);
    };

    /** Right-clicking a feature offers to delete it out of the chain - see removeFromReferenceChain. */
    private readonly onContextMenu = (event: MouseEvent) => {
        const item = this.getTimelineItem(event.target as HTMLElement | null);
        if (!item || !(item.node instanceof ReferenceShapeNode)) return;
        event.preventDefault();
        const node = item.node;
        this.document.selection.setSelectedNodes([node], false);
        this.contextMenu.openAt(event.clientX, event.clientY, (menu) => {
            menu.append(
                div(
                    {
                        className: style.contextMenuItem,
                        onclick: () => {
                            this.contextMenu.close();
                            this.deleteFeature(node);
                        },
                    },
                    label({ textContent: new Localize("timeline.deleteFeature") }),
                ),
            );
        });
    };

    private deleteFeature(node: ReferenceShapeNode) {
        let removed = false;
        Transaction.execute(this.document, "delete feature", () => {
            removed = removeFromReferenceChain(this.document, node);
        });
        if (!removed) {
            PubSub.default.pub("showToast", "toast.deleteFeature.blocked");
            return;
        }
        this.document.visual.update();
    }

    private getTimelineItem(el: HTMLElement | null): TimelineItem | undefined {
        if (!el) return undefined;
        if (el instanceof TimelineItem) return el;
        return this.getTimelineItem(el.parentElement);
    }
}

customElements.define("ui-timeline-track", TimelineTrack);
