// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    BoundingBox,
    ComponentNode,
    type EdgeMeshData,
    GeometryNode,
    type Matrix4,
    MeshDataUtils,
    MeshNode,
    MultistepCommand,
    PubSub,
    property,
    ShapeNode,
    spliceIntoReferenceChain,
    Transaction,
    VisualConfig,
    type VisualNode,
    type XYZ,
} from "@chili3d/core";
import { type PlacementKind, PlacementNode } from "../../bodys/placement";

export abstract class TransformedCommand extends MultistepCommand {
    /** Which edit command a PlacementNode created by this command re-opens on double-click. */
    protected abstract get placementKind(): PlacementKind;

    protected models?: VisualNode[];
    protected positions?: number[];

    @property("common.clone")
    get isClone() {
        return this.getPrivateValue("isClone", false);
    }
    set isClone(value: boolean) {
        this.setProperty("isClone", value);
    }

    protected abstract transfrom(p2: XYZ): Matrix4;

    protected transformPreview = (point: XYZ): EdgeMeshData => {
        const transform = this.transfrom(point);
        const positions = transform.ofPoints(this.positions!);
        return {
            position: new Float32Array(positions),
            lineType: "solid",
            color: VisualConfig.defaultEdgeColor,
            range: [],
        };
    };

    private async ensureSelectedModels() {
        this.models = this.document.selection.getSelectedVisualNodes();
        if (this.models.length > 0) return true;

        this.controller = new AsyncController();
        this.models = await this.document.picker.pickNode("prompt.select.models", this.controller, {
            multi: true,
        });

        if (this.models.length > 0) return true;
        if (this.controller.result?.status === "success") {
            PubSub.default.pub("showToast", "toast.select.noSelected");
        }
        return false;
    }

    protected override async canExcute(): Promise<boolean> {
        if (!(await this.ensureSelectedModels())) return false;

        this.positions = this.models!.flatMap((model) => {
            if (model instanceof MeshNode) {
                return model.mesh.position ? model.transform.ofPoints(model.mesh.position) : [];
            } else if (model instanceof GeometryNode) {
                return model.mesh.edges?.position ? model.transform.ofPoints(model.mesh.edges.position) : [];
            } else if (model instanceof ComponentNode) {
                return Array.from(BoundingBox.wireframe(model.boundingBox()!).position);
            }
            return [];
        });
        return true;
    }

    protected getTempLineData(start: XYZ, end: XYZ) {
        return MeshDataUtils.createEdgeMesh(start, end, VisualConfig.temporaryEdgeColor, "solid");
    }

    protected executeMainTask(): void {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const transform = this.transfrom(this.stepDatas.at(-1)!.point!);

            this.models?.forEach((x) => {
                if (x instanceof ShapeNode) {
                    this.applyToShapeNode(x, transform);
                } else if (this.isClone) {
                    const clone = x.clone();
                    clone.transform = x.transform.multiply(transform);
                    x.parent?.insertAfter(x, clone);
                } else {
                    x.transform = x.transform.multiply(transform);
                }
            });

            this.document.visual.update();
        });
    }

    /**
     * A ShapeNode target becomes a live PlacementNode referencing it, rather
     * than a baked shape with its own transform mutated in place - so the
     * move/rotate/mirror shows up as its own timeline step, stays reversible,
     * and keeps resolving if the base node's own parameters change later.
     * isClone leaves the base node visible (the placed copy sits alongside
     * it); otherwise the base is hidden and spliced into the reference chain,
     * matching Boolean/Extrude/etc.
     */
    private applyToShapeNode(node: ShapeNode, transform: Matrix4): void {
        const placement = new PlacementNode({
            document: this.document,
            baseNodeId: node.id,
            kind: this.placementKind,
            delta: transform,
        });

        if (!placement.shape.isOk) {
            PubSub.default.pub("showToast", "error.default:{0}", placement.shape.error);
            placement.dispose();
            return;
        }

        const container = node.parent ?? this.document.modelManager.rootNode;
        container.insertAfter(node, placement);

        if (!this.isClone) {
            node.visible = false;
            spliceIntoReferenceChain(this.document, node, placement);
        }
    }
}
