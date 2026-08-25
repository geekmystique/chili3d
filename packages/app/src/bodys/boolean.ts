// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IShape,
    ReferenceShapeNode,
    Result,
    type ShapeNode,
    serializable,
    serialize,
} from "@chili3d/core";

export type BooleanOperateType = "common" | "cut" | "fuse";

export interface BooleanOptions {
    document: IDocument;
    operateType: BooleanOperateType;
    baseNodeId: string;
    toolNodeIds: string[];
}

/**
 * Holds a reference to its base and tool node ids rather than a baked shape.
 * Editing a referenced node's shape (a parametric property, or another
 * feature further upstream) recomputes this node automatically. The
 * referenced nodes stay in the document tree - callers are expected to hide
 * rather than delete them - so the reference keeps resolving.
 */
@serializable()
export class BooleanNode extends ReferenceShapeNode {
    override display(): I18nKeys {
        return "body.bolean";
    }

    @serialize()
    get operateType(): BooleanOperateType {
        return this.getPrivateValue("operateType");
    }

    @serialize()
    get baseNodeId(): string {
        return this.getPrivateValue("baseNodeId");
    }

    @serialize()
    get toolNodeIds(): string[] {
        return this.getPrivateValue("toolNodeIds");
    }

    constructor(options: BooleanOptions) {
        super(options);
        this.setPrivateValue("operateType", options.operateType);
        this.setPrivateValue("baseNodeId", options.baseNodeId);
        this.setPrivateValue("toolNodeIds", options.toolNodeIds);
    }

    override redirectReference(oldId: string, newId: string): boolean {
        let changed = false;
        if (this.baseNodeId === oldId) {
            this.setProperty("baseNodeId", newId);
            changed = true;
        }
        const toolIndex = this.toolNodeIds.indexOf(oldId);
        if (toolIndex !== -1) {
            const toolNodeIds = [...this.toolNodeIds];
            toolNodeIds[toolIndex] = newId;
            this.setProperty("toolNodeIds", toolNodeIds);
            changed = true;
        }
        if (changed) this.setShape(this.generateShape());
        return changed;
    }

    /**
     * The base, not a tool - deleting a boolean is closer to "undo modifying
     * the base" than to "undo consuming a tool", so anything downstream
     * picks up the base directly. The tool(s) simply become unconsumed and
     * visible again, same as any other now-unused input.
     */
    override get primaryInputId(): string | undefined {
        return this.baseNodeId;
    }

    override generateShape(): Result<IShape> {
        const base = this.resolveInput(this.baseNodeId);
        if (!base) return Result.err(`Boolean: base shape "${this.baseNodeId}" no longer exists`);
        if (!base.shape.isOk) return Result.err(base.shape.error);

        const tools: ShapeNode[] = [];
        for (const id of this.toolNodeIds) {
            const tool = this.resolveInput(id);
            if (!tool) return Result.err(`Boolean: tool shape "${id}" no longer exists`);
            if (!tool.shape.isOk) return Result.err(tool.shape.error);
            tools.push(tool);
        }

        this.subscribeTo([base, ...tools]);

        const shape1 = base.shape.value.transformedMul(base.transform);
        const toolShapes = tools.map((t) => t.shape.value.transformedMul(t.transform));
        try {
            shape1.setTolerance(1e-6);
            toolShapes.forEach((s) => {
                s.setTolerance(1e-6);
            });
            switch (this.operateType) {
                case "common":
                    return shapeFactory.booleanCommon([shape1], toolShapes);
                case "cut":
                    return shapeFactory.booleanCut([shape1], toolShapes);
                default:
                    return shapeFactory.booleanFuse([shape1], toolShapes, true);
            }
        } finally {
            shape1.dispose();
            toolShapes.forEach((s) => {
                s.dispose();
            });
        }
    }
}
