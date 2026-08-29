// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandKeys,
    type I18nKeys,
    type IDocument,
    type IShape,
    type Matrix4,
    ReferenceShapeNode,
    Result,
    serializable,
    serialize,
} from "@chili3d/core";

/** Which interactive flow produced this placement's delta - selects the matching re-pick edit command. */
export type PlacementKind = "move" | "rotate" | "mirror";

export interface PlacementOptions {
    document: IDocument;
    baseNodeId: string;
    kind: PlacementKind;
    delta: Matrix4;
}

/**
 * Holds a reference to the base node id and the transform delta (translation,
 * rotation or mirror) applied to it, rather than baking the moved shape and
 * mutating the base node's own transform in place. Editing the base node's
 * own parameters recomputes this node. The base node is hidden, not deleted,
 * by Move/Rotate/Mirror - unless the command's isClone option is set, in
 * which case it is left visible, matching how a clone sits alongside its
 * source rather than replacing it.
 */
@serializable()
export class PlacementNode extends ReferenceShapeNode {
    override display(): I18nKeys {
        return "body.placement";
    }

    override get editCommandKey(): CommandKeys {
        switch (this.kind) {
            case "rotate":
                return "modify.placementRotateEdit";
            case "mirror":
                return "modify.placementMirrorEdit";
            default:
                return "modify.placementMoveEdit";
        }
    }

    @serialize()
    get baseNodeId(): string {
        return this.getPrivateValue("baseNodeId");
    }

    @serialize()
    get kind(): PlacementKind {
        return this.getPrivateValue("kind");
    }

    @serialize()
    get delta(): Matrix4 {
        return this.getPrivateValue("delta");
    }

    constructor(options: PlacementOptions) {
        super(options);
        this.setPrivateValue("baseNodeId", options.baseNodeId);
        this.setPrivateValue("kind", options.kind);
        this.setPrivateValue("delta", options.delta);
    }

    override redirectReference(oldId: string, newId: string): boolean {
        if (this.baseNodeId !== oldId) return false;
        this.setProperty("baseNodeId", newId);
        this.setShape(this.generateShape());
        return true;
    }

    /**
     * Re-point this feature at a new transform delta and recompute once.
     * Used by the "re-pick" edit flow (re-dragging the move/rotation/mirror)
     * to redirect an existing feature without deleting and recreating it
     * (which would break anything downstream that references it).
     */
    updateDelta(delta: Matrix4) {
        this.setProperty("delta", delta);
        this.setShape(this.generateShape());
    }

    override get primaryInputId(): string | undefined {
        return this.baseNodeId;
    }

    override generateShape(): Result<IShape> {
        const base = this.resolveInput(this.baseNodeId);
        if (!base) return Result.err(`Placement: base shape "${this.baseNodeId}" no longer exists`);
        if (!base.shape.isOk) return Result.err(base.shape.error);

        this.subscribeTo([base]);

        return Result.ok(base.shape.value.transformedMul(base.transform).transformedMul(this.delta));
    }
}
