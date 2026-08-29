// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Combobox,
    command,
    GeometryUtils,
    type I18nKeys,
    type IEdge,
    type IFace,
    type IWire,
    type JoinType,
    MultistepCommand,
    PubSub,
    property,
    type ShapeNode,
    type ShapeType,
    ShapeTypes,
    Transaction,
    type XYZ,
} from "@chili3d/core";
import { sectionRefFromPick } from "../../bodys";
import { OffsetNode } from "../../bodys/offset";
import { KeepExistingSelectionStep } from "./keepExistingSelectionStep";

const JOIN_TYPE_OPTIONS: I18nKeys[] = [
    "option.command.joinType.arc",
    "option.command.joinType.tangent",
    "option.command.joinType.intersection",
];

function joinTypeToOption(joinType: JoinType): I18nKeys {
    switch (joinType) {
        case "tangent":
            return "option.command.joinType.tangent";
        case "intersection":
            return "option.command.joinType.intersection";
        default:
            return "option.command.joinType.arc";
    }
}

function optionToJoinType(option: I18nKeys): JoinType {
    switch (option) {
        case "option.command.joinType.tangent":
            return "tangent";
        case "option.command.joinType.intersection":
            return "intersection";
        default:
            return "arc";
    }
}

/**
 * Re-picks the section (and/or sub-shape within it) of an existing
 * OffsetNode, updating it in place instead of creating a new feature - so
 * anything downstream that references it keeps working. Operates on the
 * node currently selected in the tree/timeline; invoked by double-clicking
 * that entry. distance stays independently editable through the node's own
 * Properties panel; joinType has no such route (like OffsetCommand's own
 * joinType at creation time), so it's exposed here instead, defaulting to
 * the target's current value.
 */
@command({
    key: "modify.offsetEdit",
    icon: "icon-offset",
})
export class OffsetEditCommand extends MultistepCommand {
    private targetNode?: OffsetNode;

    @property("option.command.joinType", { combobox: Combobox.from(JOIN_TYPE_OPTIONS) })
    get joinType(): I18nKeys {
        return this.getPrivateValue("joinType", joinTypeToOption(this.targetNode?.joinType ?? "arc"));
    }
    set joinType(value: I18nKeys) {
        this.setProperty("joinType", value);
    }

    protected override async canExcute(): Promise<boolean> {
        const node = this.document.selection
            .getSelectedNodes()
            .find((n): n is OffsetNode => n instanceof OffsetNode);
        if (!node) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return false;
        }
        this.targetNode = node;
        // Through the property setter (not setPrivateValue) so the already-open
        // command context panel's binding picks up the corrected value.
        this.joinType = joinTypeToOption(node.joinType);
        return true;
    }

    protected override getSteps() {
        return [
            new KeepExistingSelectionStep(
                (ShapeTypes.edge | ShapeTypes.wire | ShapeTypes.face) as ShapeType,
                "prompt.select.shape",
            ),
        ];
    }

    /** Same normal derivation as OffsetCommand.getAxis(), without the click-point-dependent direction/point. */
    private computeNormal(shape: IWire | IFace | IEdge): XYZ {
        if (shape.shapeType === ShapeTypes.edge) {
            return GeometryUtils.normal(shape as any);
        }
        const face = shape.shapeType === ShapeTypes.wire ? (shape as IWire).toFace().value : (shape as IFace);
        return face.normal(0, 0)[1];
    }

    protected override executeMainTask() {
        const node = this.targetNode;
        if (!node) return;

        const pick = this.stepDatas[0].shapes[0];
        const joinType = optionToJoinType(this.joinType);

        Transaction.execute(this.document, `edit ${node.name}`, () => {
            if (pick) {
                const { shapeType, index } = sectionRefFromPick(pick.owner.node as ShapeNode, pick.shape);
                const worldShape = pick.shape.transformedMul(pick.transform);
                node.updateSection(
                    (pick.owner.node as ShapeNode).id,
                    shapeType,
                    index,
                    this.computeNormal(worldShape as any),
                    joinType,
                );
            } else {
                node.updateSection(
                    node.sectionNodeId,
                    node.sectionShapeType,
                    node.sectionIndex,
                    node.normal,
                    joinType,
                );
            }
        });

        this.document.visual.update();
    }
}
