// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    CancelableCommand,
    Combobox,
    Continuities,
    type Continuity,
    command,
    type IEdge,
    type IShape,
    type ISubShape,
    type IVertex,
    type IWire,
    PubSub,
    property,
    Result,
    SelectShapeStep,
    type ShapeMeshData,
    type ShapeNode,
    type ShapeType,
    ShapeTypes,
    type SnapResult,
    spliceIntoReferenceChain,
    Transaction,
    VisualConfig,
} from "@chili3d/core";
import { LoftNode, sweepRefFromPick } from "../../bodys";
import { selectedWholeShapeNodes } from "../createCommand";

@command({
    key: "create.loft",
    icon: "icon-loft",
})
export class LoftCommand extends CancelableCommand {
    private visual: number | undefined = undefined;
    private readonly shapes: IShape[] = [];
    private readonly selectedDatas: SnapResult[] = [];
    private shape: Result<IShape> = Result.err("None shape");
    private readonly _continuity = Continuities[0];

    @property("option.command.isSolid")
    get isSolid() {
        return this.getPrivateValue("isSolid", false);
    }
    set isSolid(value: boolean) {
        this.setProperty("isSolid", value, () => {
            this.displayVisual();
        });
    }

    @property("option.command.isRuled")
    get isRuled() {
        return this.getPrivateValue("isRuled", false);
    }
    set isRuled(value: boolean) {
        this.setProperty("isRuled", value, () => {
            this.displayVisual();
        });
    }

    @property("option.command.continuity", {
        dependencies: [
            {
                property: "isRuled",
                value: false,
            },
        ],
        combobox: Combobox.from([...Continuities]),
    })
    get continuity(): Continuity {
        return this._continuity;
    }
    set continuity(value: Continuity) {
        this.setProperty("continuity", value, () => {
            console.log(value);
            this.displayVisual();
        });
    }

    @property("option.command.deleteObjects")
    get deleteObjects() {
        return this.getPrivateValue("deleteObjects", true);
    }
    set deleteObjects(value: boolean) {
        this.setProperty("deleteObjects", value);
    }

    @property("common.confirm")
    readonly confirm = () => {
        this.controller?.success();
    };

    protected override async executeAsync(): Promise<void> {
        try {
            while (true) {
                const data = await this.selectSection();
                if (data === undefined) {
                    if (this.controller?.result?.status === "success") {
                        break;
                    } else {
                        return;
                    }
                }

                this.shapes.push(data.shapes[0].shape.transformedMul(data.nodes![0].worldTransform()));
                this.selectedDatas.push(data);
                this.displayVisual();
            }

            Transaction.execute(this.document, "loft", () => {
                const refs = this.selectedDatas.map((data) => {
                    const pick = data.shapes[0];
                    return sweepRefFromPick(pick.owner.node as ShapeNode, pick.shape);
                });
                const node = new LoftNode({
                    document: this.document,
                    sectionNodeIds: refs.map((r) => r.nodeId),
                    sectionShapeTypes: refs.map((r) => r.shapeType),
                    sectionIndexes: refs.map((r) => r.index),
                    isSolid: this.isSolid,
                    isRuled: this.isRuled,
                    continuity: this.continuity,
                });

                if (!node.shape.isOk) {
                    PubSub.default.pub("showToast", "error.default:{0}", node.shape.error);
                    node.dispose();
                    return;
                }

                this.document.modelManager.addNode(node);
                this.repositionAfterFirstSection(node);

                if (this.deleteObjects) {
                    selectedWholeShapeNodes(this.selectedDatas).forEach((source) => {
                        source.visible = false;
                        spliceIntoReferenceChain(this.document, source, node);
                    });
                }
            });
        } finally {
            this.clearVisual();
        }
    }

    /**
     * The new Loft was appended to the tree by modelManager.addNode - move it
     * to sit right after its first section node (LoftNode's primaryInputId)
     * instead, so it lands at its logical spot in the tree/timeline rather
     * than always at the end, matching Extrude/Revolve/Sweep.
     */
    private repositionAfterFirstSection(node: LoftNode): void {
        if (!node.parent) return;
        const section = this.document.modelManager.findNode((n) => n.id === node.sectionNodeIds[0]);
        if (!section?.parent) return;
        node.parent.move(node, section.parent, section);
    }

    private async selectSection() {
        this.controller = new AsyncController();
        const step = new SelectShapeStep(
            (ShapeTypes.vertex | ShapeTypes.wire | ShapeTypes.edge) as ShapeType,
            "prompt.select.section",
        );
        return await step.execute(this.document, this.controller);
    }

    private clearVisual() {
        this.removeVisual();
        this.document.visual.highlighter.clear();
        this.document.visual.update();
    }

    private displayVisual() {
        this.removeVisual();
        const edges: ShapeMeshData[] = this.shapes.map((x) => {
            const m = x.mesh.edges!;
            m.color = VisualConfig.selectedEdgeColor;
            m.lineWidth = 3;
            return m;
        });
        if (this.shapes.length > 1) {
            this.shape = shapeFactory.loft(
                this.shapes as (IVertex | IEdge | IWire)[],
                this.isSolid,
                this.isRuled,
                this.continuity,
            );
            if (!this.shape.isOk) {
                PubSub.default.pub("showToast", "error.default:{0}", this.shape.error);
            } else {
                edges.push(this.shape.value.mesh.faces!);
            }
        }
        this.visual = this.document.visual.context.displayMesh(edges, {
            meshOpacity: 0.5,
        });
        this.document.visual.update();
        return true;
    }

    readonly removeVisual = () => {
        if (this.visual !== undefined) {
            this.document.visual.context.removeMesh(this.visual);
            this.visual = undefined;
        }
    };
}
