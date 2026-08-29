// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { GeometryNode, PubSub, Transaction } from "@chili3d/core";
import { PlacementNode } from "../../bodys/placement";
import type { TransformedCommand } from "./transformedCommand";

// biome-ignore lint/suspicious/noExplicitAny: standard TS mixin constructor signature.
type TransformedCommandCtor = new (...args: any[]) => TransformedCommand;

/**
 * Turns a placement command (Move/Rotate/Mirror) into its "edit" counterpart:
 * re-drags/re-picks an existing PlacementNode's delta in place instead of
 * creating a new feature, reusing the base command's own step flow and
 * transform computation entirely - only canExcute (find the target instead
 * of the current selection) and executeMainTask (update the target instead
 * of creating a new node) differ, identically across Move/Rotate/Mirror.
 */
export function placementEditOf<TBase extends TransformedCommandCtor>(Base: TBase) {
    abstract class PlacementEditCommand extends Base {
        targetNode?: PlacementNode;

        protected override async canExcute(): Promise<boolean> {
            const node = this.document.selection
                .getSelectedNodes()
                .find((n): n is PlacementNode => n instanceof PlacementNode);
            const base = node && this.document.modelManager.findNode((n) => n.id === node.baseNodeId);
            if (!node || !(base instanceof GeometryNode)) {
                PubSub.default.pub("showToast", "toast.select.noSelected");
                return false;
            }

            this.targetNode = node;
            this.models = [base];
            this.positions = base.mesh.edges?.position
                ? base.transform.ofPoints(base.mesh.edges.position)
                : [];
            return true;
        }

        protected override executeMainTask(): void {
            const node = this.targetNode;
            if (!node) return;

            const transform = this.transfrom(this.stepDatas.at(-1)!.point!);

            Transaction.execute(this.document, `edit ${node.name}`, () => {
                node.updateDelta(transform);
            });

            this.document.visual.update();
        }
    }
    return PlacementEditCommand;
}
