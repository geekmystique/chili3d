// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type INode,
    MultistepCommand,
    PubSub,
    type ShapeNode,
    type ShapeType,
    ShapeTypes,
    Transaction,
} from "@chili3d/core";
import { sectionRefFromPick } from "../../bodys";
import { KeepExistingSelectionStep } from "./keepExistingSelectionStep";

/** The shared shape of a node built from one face/edge/wire section reference (Extrude, ThickSolid). */
export interface SingleSectionNode extends INode {
    readonly sectionNodeId: string;
    readonly sectionShapeType: ShapeType | undefined;
    readonly sectionIndex: number | undefined;
    updateSection(nodeId: string, shapeType: ShapeType | undefined, index: number | undefined): void;
}

// biome-ignore lint/suspicious/noExplicitAny: standard TS mixin constructor signature.
type SingleSectionNodeCtor<T extends SingleSectionNode> = new (...args: any[]) => T;

/**
 * Builds the "re-pick the section" edit command shared by every node whose
 * whole shape comes from one face/edge/wire reference with no other input
 * (Extrude, ThickSolid) - identical canExcute()/getSteps()/executeMainTask()
 * across both, differing only in which node type they target. Nodes with a
 * second reference (Revolve's axis) or extra per-type state exposed on the
 * edit command itself (Offset's joinType) keep their own file instead of
 * forcing that extra state through this shared shape.
 */
export function singleSectionEditOf<T extends SingleSectionNode>(NodeType: SingleSectionNodeCtor<T>) {
    abstract class SingleSectionEditCommand extends MultistepCommand {
        targetNode?: T;

        protected override async canExcute(): Promise<boolean> {
            const node = this.document.selection
                .getSelectedNodes()
                .find((n): n is T => n instanceof NodeType);
            if (!node) {
                PubSub.default.pub("showToast", "toast.select.noSelected");
                return false;
            }
            this.targetNode = node;
            return true;
        }

        protected override getSteps() {
            return [
                new KeepExistingSelectionStep(
                    (ShapeTypes.face | ShapeTypes.edge | ShapeTypes.wire) as ShapeType,
                    "prompt.select.shape",
                ),
            ];
        }

        protected override executeMainTask() {
            const node = this.targetNode;
            if (!node) return;

            const pick = this.stepDatas[0].shapes[0];

            Transaction.execute(this.document, `edit ${node.name}`, () => {
                if (pick) {
                    const { shapeType, index } = sectionRefFromPick(pick.owner.node as ShapeNode, pick.shape);
                    node.updateSection((pick.owner.node as ShapeNode).id, shapeType, index);
                } else {
                    node.updateSection(node.sectionNodeId, node.sectionShapeType, node.sectionIndex);
                }
            });

            this.document.visual.update();
        }
    }
    return SingleSectionEditCommand;
}
