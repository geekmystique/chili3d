// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandKeys,
    type I18nKeys,
    type IShape,
    type IShell,
    Result,
    serializable,
} from "@chili3d/core";
import { repairShape } from "./shapeUtils";
import { SourceListShapeNode } from "./sourceListShapeNode";

/**
 * Holds references to the shell node ids that bound this solid, rather than
 * baked shell shapes. Editing a referenced node's own parameters recomputes
 * this node. The referenced nodes are hidden, not deleted, by ConvertToSolid,
 * so the references keep resolving.
 */
@serializable()
export class SolidNode extends SourceListShapeNode {
    protected readonly errorLabel = "Solid";

    override display(): I18nKeys {
        return "body.solid";
    }

    override get editCommandKey(): CommandKeys {
        return "modify.solidEdit";
    }

    protected override combineShapes(shapes: IShape[]): Result<IShape> {
        const shapeResult = shapeFactory.solid(shapes as IShell[]);
        if (!shapeResult.isOk) return shapeResult;

        return Result.ok(repairShape(shapeResult.value, 1e-7));
    }
}
