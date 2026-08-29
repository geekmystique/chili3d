// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandKeys,
    type I18nKeys,
    type IEdge,
    type IShape,
    type Result,
    ShapeTypes,
    serializable,
} from "@chili3d/core";
import { SourceListShapeNode } from "./sourceListShapeNode";

/**
 * Holds references to the edge/wire node ids being combined, rather than
 * baked edge shapes. Editing a referenced node's own parameters recomputes
 * this node. The referenced nodes are hidden, not deleted, by ConvertToWire,
 * so the references keep resolving.
 */
@serializable()
export class WireNode extends SourceListShapeNode {
    protected readonly errorLabel = "Wire";

    override display(): I18nKeys {
        return "body.wire";
    }

    override get editCommandKey(): CommandKeys {
        return "modify.wireEdit";
    }

    protected override combineShapes(shapes: IShape[]): Result<IShape> {
        const edges: IEdge[] = [];
        for (const shape of shapes) {
            if (shape.shapeType === ShapeTypes.edge) {
                edges.push(shape as IEdge);
            } else if (shape.shapeType === ShapeTypes.wire) {
                edges.push(...(shape.findSubShapes(ShapeTypes.edge) as IEdge[]));
            }
        }

        return shapeFactory.wire(edges);
    }
}
