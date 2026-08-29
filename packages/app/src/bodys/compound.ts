// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type CommandKeys, type I18nKeys, type IShape, type Result, serializable } from "@chili3d/core";
import { SourceListShapeNode } from "./sourceListShapeNode";

/**
 * Holds references to the node ids combined into this compound, rather than
 * baked shapes. Editing a referenced node's own parameters recomputes this
 * node. The referenced nodes are hidden, not deleted, by ConvertToCompound,
 * so the references keep resolving.
 */
@serializable()
export class CompoundNode extends SourceListShapeNode {
    protected readonly errorLabel = "Compound";

    override display(): I18nKeys {
        return "body.compound";
    }

    override get editCommandKey(): CommandKeys {
        return "modify.compoundEdit";
    }

    protected override combineShapes(shapes: IShape[]): Result<IShape> {
        return shapeFactory.combine(shapes);
    }
}
