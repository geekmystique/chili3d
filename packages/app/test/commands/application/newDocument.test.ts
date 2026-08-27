// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { createMockApplication } from "@chili3d/core/test-utils";
import { describe, expect, test } from "@rstest/core";
import { NewDocument } from "../../../src/commands/application/newDocument";

describe("NewDocument", () => {
    test("should have command metadata", () => {
        const data = (NewDocument as any).prototype.data;
        expect(data).not.toBeNull();
        expect(data.key).toBe("doc.new");
        expect(data.icon).toBe("icon-new");
    });

    test("should have isApplicationCommand flag", () => {
        const data = (NewDocument as any).prototype.data;
        expect(data.isApplicationCommand).toBe(true);
    });

    test("should call app.newDocument with an 'Untitled N' name", async () => {
        const app = createMockApplication();
        let newDocName = "";
        app.newDocument = async (name: string) => {
            newDocName = name;
            return {} as any;
        };

        const cmd = new NewDocument();
        await cmd.execute(app);

        expect(newDocName).toMatch(/^Untitled \d+$/);
    });

    test("should increment the number on each call", async () => {
        const app = createMockApplication();
        const names: string[] = [];
        app.newDocument = async (name: string) => {
            names.push(name);
            return {} as any;
        };

        const cmd = new NewDocument();
        await cmd.execute(app);
        await cmd.execute(app);

        const [first, second] = names.map((n) => Number(n.match(/\d+$/)![0]));
        expect(second).toBe(first + 1);
    });
});
