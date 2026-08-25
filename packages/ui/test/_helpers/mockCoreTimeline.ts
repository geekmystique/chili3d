// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Registers the `@chili3d/core` mock for the timeline test: a GeometryNode marker
// class for instanceof checks, immediate Transaction, no-op Binding.
// Import this module BEFORE the module under test (but AFTER the test-utils import) -
// see mockCoreTree.ts for why.

import { rs } from "@rstest/core";

rs.mock("@chili3d/core", () => {
    const actual = rs.hoisted(() => require("@chili3d/core"));
    const { BindingMock, TransactionMock } = rs.hoisted(() => require("./coreMocks"));
    class VisualNode {}
    class GeometryNode extends VisualNode {}
    return {
        ...actual,
        Binding: BindingMock,
        Transaction: TransactionMock,
        VisualNode,
        GeometryNode,
    };
});
