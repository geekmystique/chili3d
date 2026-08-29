// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    CancelableCommand,
    command,
    type IDocument,
    type INode,
    type IShapeFilter,
    PubSub,
    type ReferenceShapeNode,
    Result,
    SelectNodeStep,
    ShapeNode,
    ShapeNodeFilter,
    ShapeTypes,
    spliceIntoReferenceChain,
    Transaction,
} from "@chili3d/core";
import { CompoundNode } from "../../bodys/compound";
import { FaceNode } from "../../bodys/face";
import { ShellNode } from "../../bodys/shell";
import { SolidNode } from "../../bodys/solid";
import { WireNode } from "../../bodys/wire";

abstract class ConvertCommand extends CancelableCommand {
    async executeAsync(): Promise<void> {
        const models = await this.getOrPickModels(this.document);
        if (!models) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return;
        }
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const node = this.create(this.document, models);
            if (!node.isOk) {
                PubSub.default.pub("showToast", "error.default:{0}", node.error);
            } else {
                // Insert right after the last consumed node so the conversion lands
                // at its logical spot in the tree/timeline, not always at the end.
                const anchor = models[models.length - 1];
                if (anchor.parent === this.document.modelManager.rootNode) {
                    this.document.modelManager.rootNode.insertAfter(anchor, node.value);
                } else {
                    this.document.modelManager.rootNode.add(node.value);
                }
                // Hide rather than delete the consumed nodes - the new node keeps a
                // live reference to them, so deleting would break that reference.
                models.forEach((x) => {
                    x.visible = false;
                    if (x instanceof ShapeNode) spliceIntoReferenceChain(this.document, x, node.value);
                });
                this.document.visual.update();
                PubSub.default.pub("showToast", "toast.success");
            }
        });
    }

    protected abstract create(document: IDocument, models: INode[]): Result<ReferenceShapeNode>;
    protected shapeFilter(): IShapeFilter {
        return {
            allow: (shape) => shape.shapeType === ShapeTypes.edge || shape.shapeType === ShapeTypes.wire,
        };
    }

    async getOrPickModels(document: IDocument) {
        const filter = this.shapeFilter();
        const models = this._getSelectedModels(document, filter);
        document.selection.clearSelection();
        if (models.length > 0) return models;

        const step = new SelectNodeStep("prompt.select.models", {
            filter: new ShapeNodeFilter(filter),
            multiple: true,
        });
        this.controller = new AsyncController();
        const data = await step.execute(document, this.controller);
        document.selection.clearSelection();
        return data?.nodes;
    }

    private _getSelectedModels(document: IDocument, filter?: IShapeFilter) {
        return document.selection
            .getSelectedNodes()
            .map((x) => x as ShapeNode)
            .filter((x) => {
                if (x === undefined) return false;
                const shape = x.shape.value;
                if (shape === undefined) return false;
                if (filter !== undefined && !filter.allow(shape, x.transform)) return false;
                return true;
            });
    }
}

@command({
    key: "convert.toWire",
    icon: "icon-toPoly",
})
export class ConvertToWire extends ConvertCommand {
    protected override create(document: IDocument, models: ShapeNode[]): Result<ReferenceShapeNode> {
        const wireBody = new WireNode({ document, sourceNodeIds: models.map((x) => x.id) });
        const shape = wireBody.generateShape();
        if (!shape.isOk) return Result.err(shape.error);
        wireBody.shape = shape;

        return Result.ok(wireBody);
    }
}

@command({
    key: "convert.toFace",
    icon: "icon-toFace",
})
export class ConvertToFace extends ConvertCommand {
    protected override create(document: IDocument, models: ShapeNode[]): Result<ReferenceShapeNode> {
        const faceBody = new FaceNode({ document, sourceNodeIds: models.map((x) => x.id) });
        const shape = faceBody.generateShape();
        if (!shape.isOk) return Result.err(shape.error);
        faceBody.shape = shape;

        return Result.ok(faceBody);
    }
}

@command({
    key: "convert.toShell",
    icon: "icon-toShell",
})
export class ConvertToShell extends ConvertCommand {
    protected override shapeFilter(): IShapeFilter {
        return {
            allow: (shape) => shape.shapeType === ShapeTypes.face,
        };
    }

    protected override create(document: IDocument, models: ShapeNode[]): Result<ReferenceShapeNode> {
        const shellBody = new ShellNode({ document, sourceNodeIds: models.map((x) => x.id) });
        const shape = shellBody.generateShape();
        if (!shape.isOk) return Result.err(shape.error);
        shellBody.shape = shape;

        return Result.ok(shellBody);
    }
}

@command({
    key: "convert.toSolid",
    icon: "icon-toSolid",
})
export class ConvertToSolid extends ConvertCommand {
    protected override shapeFilter(): IShapeFilter {
        return {
            allow: (shape) => shape.shapeType === ShapeTypes.shell,
        };
    }

    protected override create(document: IDocument, models: ShapeNode[]): Result<ReferenceShapeNode> {
        const solidBody = new SolidNode({ document, sourceNodeIds: models.map((x) => x.id) });
        const shape = solidBody.generateShape();
        if (!shape.isOk) return Result.err(shape.error);
        solidBody.shape = shape;

        return Result.ok(solidBody);
    }
}

@command({
    key: "convert.toCompound",
    icon: "icon-compound",
})
export class ConvertToCompound extends ConvertCommand {
    protected override shapeFilter(): IShapeFilter {
        return {
            allow: () => true,
        };
    }

    protected override create(document: IDocument, models: ShapeNode[]): Result<ReferenceShapeNode> {
        const compoundBody = new CompoundNode({ document, sourceNodeIds: models.map((x) => x.id) });
        const shape = compoundBody.generateShape();
        if (!shape.isOk) return Result.err(shape.error);
        compoundBody.shape = shape;

        return Result.ok(compoundBody);
    }
}
