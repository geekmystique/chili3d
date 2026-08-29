// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandKeys,
    type I18nKeys,
    type IFace,
    type IShape,
    type Result,
    serializable,
} from "@chili3d/core";
import { SourceListShapeNode } from "./sourceListShapeNode";

/**
 * Holds references to the face node ids that bound this shell, rather than
 * baked face shapes. Editing a referenced node's own parameters recomputes
 * this node. The referenced nodes are hidden, not deleted, by ConvertToShell,
 * so the references keep resolving.
 */
@serializable()
export class ShellNode extends SourceListShapeNode {
    protected readonly errorLabel = "Shell";

    override display(): I18nKeys {
        return "body.shell";
    }

    override get editCommandKey(): CommandKeys {
        return "modify.shellEdit";
    }

    protected override combineShapes(shapes: IShape[]): Result<IShape> {
        return shapeFactory.shell(shapes as IFace[]);
    }
}
