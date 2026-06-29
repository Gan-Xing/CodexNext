import { describe, expect, it } from "vitest";
import {
  FAST_SERVICE_TIER,
  filterSlashCommands,
  resolveSlashCommandContext,
  resolveSubmittedSlashCommand
} from "./slash-commands";

describe("slash commands", () => {
  it("maps /fast to the Codex fast service tier only", () => {
    expect(FAST_SERVICE_TIER).toBe("priority");
  });

  it("resolves a first-line slash command query at the cursor", () => {
    expect(resolveSlashCommandContext("/", 1)).toMatchObject({ query: "" });
    expect(resolveSlashCommandContext("/fa", 3)).toMatchObject({ query: "fa" });
    expect(resolveSlashCommandContext("/fast\nhello", 3)).toMatchObject({
      query: "fast"
    });
  });

  it("does not resolve commands outside the first command token", () => {
    expect(resolveSlashCommandContext(" /fast", 6)).toBeNull();
    expect(resolveSlashCommandContext("hello /fast", 11)).toBeNull();
    expect(resolveSlashCommandContext("/fast now", 9)).toBeNull();
    expect(resolveSlashCommandContext("/fast\nhello", 8)).toBeNull();
  });

  it("filters available commands by prefix", () => {
    expect(filterSlashCommands("").map((command) => command.name)).toEqual(["fast"]);
    expect(filterSlashCommands("f").map((command) => command.name)).toEqual(["fast"]);
    expect(filterSlashCommands("fa").map((command) => command.name)).toEqual(["fast"]);
    expect(filterSlashCommands("foo")).toEqual([]);
  });

  it("only treats exact command submissions as slash commands", () => {
    expect(resolveSubmittedSlashCommand("/fast")?.id).toBe("fast");
    expect(resolveSubmittedSlashCommand("/fast ")?.id).toBe("fast");
    expect(resolveSubmittedSlashCommand(" /fast")).toBeNull();
    expect(resolveSubmittedSlashCommand("/fast now")).toBeNull();
    expect(resolveSubmittedSlashCommand("/fast\nhello")).toBeNull();
  });
});
