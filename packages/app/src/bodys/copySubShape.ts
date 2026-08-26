// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IShape,
    ReferenceShapeNode,
    Result,
    type ShapeType,
    serializable,
    serialize,
} from "@chili3d/core";
import { resolveSweepRefShape, type SweepRef } from "./sweep";

export interface CopySubShapeOptions {
    document: IDocument;
    sourceNodeId: string;
    subShapeType: ShapeType;
    index: number;
}

/**
 * Holds a reference to the source node id (and the copied sub-shape's type +
 * index within it) rather than a baked, cloned-off copy of that sub-shape.
 * Editing the source node's own parameters recomputes this node. The source
 * node is left visible - CopySubShapeCommand does not hide it, the copy sits
 * alongside it, not in place of it.
 */
@serializable()
export class CopySubShapeNode extends ReferenceShapeNode {
    override display(): I18nKeys {
        return "body.copySubShape";
    }

    @serialize()
    get sourceNodeId(): string {
        return this.getPrivateValue("sourceNodeId");
    }

    @serialize()
    get subShapeType(): ShapeType {
        return this.getPrivateValue("subShapeType");
    }

    @serialize()
    get index(): number {
        return this.getPrivateValue("index");
    }

    constructor(options: CopySubShapeOptions) {
        super(options);
        this.setPrivateValue("sourceNodeId", options.sourceNodeId);
        this.setPrivateValue("subShapeType", options.subShapeType);
        this.setPrivateValue("index", options.index);
    }

    override redirectReference(oldId: string, newId: string): boolean {
        if (this.sourceNodeId !== oldId) return false;
        this.setProperty("sourceNodeId", newId);
        this.setShape(this.generateShape());
        return true;
    }

    override get primaryInputId(): string | undefined {
        return this.sourceNodeId;
    }

    override generateShape(): Result<IShape> {
        const base = this.resolveInput(this.sourceNodeId);
        if (!base) return Result.err(`CopySubShape: source "${this.sourceNodeId}" no longer exists`);
        if (!base.shape.isOk) return Result.err(base.shape.error);

        this.subscribeTo([base]);

        const ref: SweepRef = { nodeId: this.sourceNodeId, shapeType: this.subShapeType, index: this.index };
        return resolveSweepRefShape(base.shape.value.transformedMul(base.transform), ref, "CopySubShape");
    }
}
