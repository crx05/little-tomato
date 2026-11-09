"""Real-browser acceptance tests. Requires Python Playwright and Chromium.

Run against the local HTTP server, or pass --intercept to serve project files
through Playwright request fulfillment without opening a listening port.
"""
import mimetypes
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import unquote, urlsplit

from playwright.sync_api import sync_playwright, expect

PROJECT = Path(__file__).resolve().parent.parent
BASE = os.environ.get("TOMATO_TEST_URL", "http://localhost:4311/homework-tomato/")
KEY = "little-tomato:v1"
INTERCEPT = "--intercept" in sys.argv


def configure(context):
    if not INTERCEPT:
        return

    def fulfill(route):
        relative = unquote(urlsplit(route.request.url).path)
        prefix = urlsplit(BASE).path
        if not relative.startswith(prefix):
            route.abort()
            return
        name = relative[len(prefix):] or "index.html"
        path = (PROJECT / name).resolve()
        if not path.is_relative_to(PROJECT) or not path.is_file():
            route.fulfill(status=404, body="Not found")
            return
        route.fulfill(status=200, content_type=mimetypes.guess_type(path)[0] or "application/octet-stream", body=path.read_bytes())

    context.route("**/*", fulfill)


def run():
    with sync_playwright() as p:
        options = {"headless": True, "args": ["--disable-dev-shm-usage"]}
        if os.environ.get("TOMATO_CHROMIUM"):
            options["executable_path"] = os.environ["TOMATO_CHROMIUM"]
        browser = p.chromium.launch(**options)
        context = browser.new_context(viewport={"width": 1440, "height": 1100}, timezone_id="Asia/Shanghai", reduced_motion="reduce")
        configure(context)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        clock_start = datetime.now(timezone.utc)
        page.clock.install(time=clock_start)
        page.clock.pause_at(clock_start + timedelta(seconds=1))
        page.goto(BASE)
        expect(page.locator("#timer-number")).to_have_text("20:00")
        expect(page.locator("#empty-tasks")).to_be_visible()
        page.screenshot(path=str(PROJECT / "preview-desktop.png"), full_page=True)

        # Tasks are real text, including markup-looking user input.
        page.locator("#task-title").fill("完成数学练习第 12 页")
        page.locator("#task-form button[type=submit]").click()
        page.locator("#task-title").fill('<img src=x onerror="alert(1)">')
        page.locator("#task-form button[type=submit]").click()
        assert page.locator("#task-list img").count() == 0
        expect(page.locator("#task-list .task-item")).to_have_count(2)
        expect(page.locator("#current-task-label")).to_contain_text("数学练习")

        page.locator("#settings-button").click()
        for name in ["focus", "short", "long"]:
            page.locator(f'#settings-form input[name="{name}"]').fill("1")
        page.locator('#settings-form button[type="submit"]').click()
        expect(page.locator("#timer-number")).to_have_text("01:00")
        page.locator("#start-button").click()
        page.clock.fast_forward(10_000)
        page.locator("#start-button").click()
        expect(page.locator("#timer-number")).to_have_text("00:50")
        page.clock.fast_forward(120_000)
        expect(page.locator("#timer-number")).to_have_text("00:50")
        page.reload()
        expect(page.locator("#start-label")).to_have_text("继续专注")
        expect(page.locator("#timer-number")).to_have_text("00:50")
        page.locator("#start-button").click()
        page.clock.fast_forward(50_250)
        expect(page.locator("#completion-dialog")).to_be_visible()
        expect(page.locator("#garden")).to_have_attribute("aria-label", "今天已收获 1 颗番茄，目标 4 颗")
        page.reload()
        expect(page.locator("#completion-dialog")).to_be_visible()
        assert page.evaluate(f"JSON.parse(localStorage.getItem('{KEY}')).sessions.length") == 1
        page.locator("#complete-task-button").click()
        expect(page.locator("#complete-task-button")).to_be_disabled()
        page.locator("#next-round-button").click()
        page.clock.fast_forward(60_250)
        expect(page.locator("#completion-title")).to_have_text("休息好了吗？")
        assert page.evaluate(f"JSON.parse(localStorage.getItem('{KEY}')).sessions.length") == 1
        page.locator("#dismiss-completion").click()
        page.locator('.main-nav [data-view="harvest"]').click()
        expect(page.locator("#harvest-view")).to_be_visible()
        expect(page.locator("#harvest-count")).to_have_text("1 颗")
        expect(page.locator("#history-list")).to_contain_text("完成数学练习第 12 页")
        page.screenshot(path=str(PROJECT / "preview-harvest.png"), full_page=True)
        page.locator('.main-nav [data-view="focus"]').click()

        # Cancel preserves progress. Confirming reset never grants a reward.
        page.locator("#start-button").click()
        page.clock.fast_forward(5_000)
        page.locator("#reset-button").click()
        page.locator("#confirm-cancel").click()
        expect(page.locator("#start-label")).to_have_text("暂停一下")
        page.locator("#reset-button").click()
        page.locator("#confirm-accept").click()
        expect(page.locator("#timer-number")).to_have_text("01:00")
        page.locator("#zen-button").click()
        expect(page.locator("body")).to_have_class("zen-mode")
        page.keyboard.press("Escape")
        expect(page.locator("body")).not_to_have_class("zen-mode")
        page.locator("#task-list .delete-task").last.click()
        page.locator("#confirm-accept").click()
        assert page.evaluate(f"JSON.parse(localStorage.getItem('{KEY}')).sessions.length") == 1

        # Layout at narrow widths and real settings-dialog interaction.
        for width in [320, 375, 768, 1440]:
            page.set_viewport_size({"width": width, "height": 900})
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Overflow at {width}px"
            page.locator("#settings-button").click()
            expect(page.locator("#settings-dialog")).to_be_visible()
            page.keyboard.press("Escape")
            if width == 375:
                page.screenshot(path=str(PROJECT / "preview-mobile.png"), full_page=True)
        assert errors == [], errors

        # Degraded storage still permits the primary timer flow.
        blocked = browser.new_context()
        configure(blocked)
        blocked.add_init_script("Object.defineProperty(window, 'localStorage', {get() { throw new Error('storage blocked'); }});")
        blocked_page = blocked.new_page()
        blocked_page.goto(BASE)
        expect(blocked_page.locator("#storage-notice")).to_be_visible()
        blocked_page.locator("#start-button").click()
        expect(blocked_page.locator("#start-label")).to_have_text("暂停一下")
        blocked.close()
        browser.close()
        print("PASS: tasks, safe text, settings, pause/resume, reload, completion, rest, history, reset, zen, responsive overflow, storage fallback")


if __name__ == "__main__":
    run()
