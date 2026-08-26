// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    type IShapeFilter,
    MultistepCommand,
    PubSub,
    type ReferenceShapeNode,
    ShapeNodeFilter,
    ShapeTypes,
    Transaction,
} from "@chili3d/core";
import { CompoundNode } from "../../bodys/compound";
import { FaceNode } from "../../bodys/face";
import { ShellNode } from "../../bodys/shell";
import { SolidNode } from "../../bodys/solid";
import { WireNode } from "../../bodys/wire";
import { KeepExistingNodeSelectionStep } from "./keepExistingSelectionStep";

interface SourceListNode extends ReferenceShapeNode {
    sourceNodeIds: string[];
    updateSources(sourceNodeIds: string[]): void;
}

/**
 * Re-picks the source selection of an existing Wire/Face/Shell/Solid/Compound
 * conversion node, updating it in place instead of creating a new feature -
 * so anything downstream that references it keeps working. Operates on the
 * node currently selected in the tree/timeline; invoked by double-clicking
 * that entry. Confirming without picking anything new leaves the current
 * sources untouched.
 */
abstract class ConvertEditCommand extends MultistepCommand {
    protected targetNode?: SourceListNode;

    protected abstract findTargetNode(): SourceListNode | undefined;
    protected abstract shapeFilter(): IShapeFilter;

    protected override async canExcute(): Promise<boolean> {
        const node = this.findTargetNode();
        if (!node) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return false;
        }
        this.targetNode = node;
        return true;
    }

    protected override getSteps() {
        return [
            new KeepExistingNodeSelectionStep("prompt.select.models", {
                filter: new ShapeNodeFilter(this.shapeFilter()),
                multiple: true,
            }),
        ];
    }

    protected override executeMainTask() {
        const node = this.targetNode;
        if (!node) return;

        const picked = this.stepDatas[0].nodes ?? [];

        Transaction.execute(this.document, `edit ${node.name}`, () => {
            node.updateSources(picked.length > 0 ? picked.map((n) => n.id) : node.sourceNodeIds);
        });

        if (!node.shape.isOk) {
            PubSub.default.pub("displayError", node.shape.error);
        }
        this.document.visual.update();
    }
}

@command({
    key: "modify.wireEdit",
    icon: "icon-toPoly",
})
export class WireEditCommand extends ConvertEditCommand {
    protected findTargetNode() {
        return this.document.selection.getSelectedNodes().find((n): n is WireNode => n instanceof WireNode);
    }
    protected shapeFilter(): IShapeFilter {
        return {
            allow: (shape) => shape.shapeType === ShapeTypes.edge || shape.shapeType === ShapeTypes.wire,
        };
    }
}

@command({
    key: "modify.faceEdit",
    icon: "icon-toFace",
})
export class FaceEditCommand extends ConvertEditCommand {
    protected findTargetNode() {
        return this.document.selection.getSelectedNodes().find((n): n is FaceNode => n instanceof FaceNode);
    }
    protected shapeFilter(): IShapeFilter {
        return {
            allow: (shape) => shape.shapeType === ShapeTypes.edge || shape.shapeType === ShapeTypes.wire,
        };
    }
}

@command({
    key: "modify.shellEdit",
    icon: "icon-toShell",
})
export class ShellEditCommand extends ConvertEditCommand {
    protected findTargetNode() {
        return this.document.selection.getSelectedNodes().find((n): n is ShellNode => n instanceof ShellNode);
    }
    protected shapeFilter(): IShapeFilter {
        return { allow: (shape) => shape.shapeType === ShapeTypes.face };
    }
}

@command({
    key: "modify.solidEdit",
    icon: "icon-toSolid",
})
export class SolidEditCommand extends ConvertEditCommand {
    protected findTargetNode() {
        return this.document.selection.getSelectedNodes().find((n): n is SolidNode => n instanceof SolidNode);
    }
    protected shapeFilter(): IShapeFilter {
        return { allow: (shape) => shape.shapeType === ShapeTypes.shell };
    }
}

@command({
    key: "modify.compoundEdit",
    icon: "icon-compound",
})
export class CompoundEditCommand extends ConvertEditCommand {
    protected findTargetNode() {
        return this.document.selection
            .getSelectedNodes()
            .find((n): n is CompoundNode => n instanceof CompoundNode);
    }
    protected shapeFilter(): IShapeFilter {
        return { allow: () => true };
    }
}
