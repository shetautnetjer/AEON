"""Bounded, synthetic qualification; imports native source, never a live board.

Run: python -B -m unittest -v test_handoff_contract
No production patch. ControllerGate is a fixture-only procedural specification,
not native authorization, a persistent service, or an installed event consumer.
"""
import contextlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
SOURCE = Path('/home/aya-hmw/.hermes/hermes-agent')
sys.dont_write_bytecode = True
# Do not inherit a worker's live board, profile, model keys or hook settings.
os.environ.clear()
os.environ.update(PATH='/usr/bin:/bin', PYTHONDONTWRITEBYTECODE='1')
sys.path.insert(0, str(SOURCE))


def audit(event, args):
    if event in ('subprocess.Popen', 'os.system', 'os.posix_spawn', 'socket.connect',
                 'socket.bind', 'os.kill', 'os.killpg'):
        raise RuntimeError('Fixture forbids external effect: ' + event)
    if event == 'sqlite3.connect' and str(args[0]) != ':memory:':
        if not Path(args[0]).resolve().is_relative_to(ROOT):
            raise RuntimeError('Fixture forbids non-fixture database')
    if event == 'open' and isinstance(args[0], (str, bytes, os.PathLike)):
        path = Path(os.fsdecode(args[0])).resolve()
        mode, flags = args[1], args[2]
        writing = (isinstance(mode, str) and any(c in mode for c in 'wax+')) or (
            isinstance(flags, int) and bool(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT)))
        if writing and not path.is_relative_to(ROOT):
            raise RuntimeError('Fixture forbids outside write: ' + str(path))
        private = Path('/home/aya-hmw/.hermes')
        if path.is_relative_to(private) and not (
            path.is_relative_to(SOURCE) or path.is_relative_to(Path(sys.prefix))
            or path.is_relative_to(Path(sys.base_prefix))):
            raise RuntimeError('Fixture forbids private Hermes read: ' + str(path))


sys.addaudithook(audit)


class ControllerGate:
    """Local demonstration: notification is a hint, never approval or unblock.

    Identity uses the native board/task/run/event IDs. This ephemeral set is
    deliberately NOT a claim of durable/restart-safe exactly-once delivery.
    """
    def __init__(self, board):
        self.board, self.seen, self.accepted = board, set(), set()

    def receive(self, conn, board, event):
        key = (board, event.task_id, event.run_id, event.id)
        if board != self.board:
            return 'wrong-board'
        if key in self.seen:
            return 'duplicate'
        self.seen.add(key)
        task = kb.get_task(conn, event.task_id)
        run = kb.latest_run(conn, event.task_id)
        expected = {'completed': 'done', 'blocked': 'blocked'}.get(event.kind)
        if not run or run.id != event.run_id or task.status != expected:
            return 'stale'
        return 'delivery-pending-controller' if event.kind == 'completed' else 'hold'

    def accept(self, conn, task_id, *, actor, expected_run, expected_result):
        task, run = kb.get_task(conn, task_id), kb.latest_run(conn, task_id)
        if actor != 'AYA' or task.status != 'done' or not run or run.id != expected_run:
            return False
        if task.result != expected_result:
            return False
        self.accepted.add((self.board, task_id, run.id))
        return True


class HandoffTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='synthetic-', dir=ROOT)
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        os.environ.update(HERMES_HOME=str(self.home), HERMES_KANBAN_DB=str(self.home / 'board.db'),
                          HERMES_KANBAN_BOARD='default', HERMES_GATEWAY_LOCK_DIR=str(self.home / 'locks'))
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(Path, 'home', return_value=self.home))
        global kb, kbc, kbd, kbn, decomp, dispatcher
        from hermes_cli import kanban_db as kb, kanban_db_connect as kbc
        from hermes_cli import kanban_db_dispatch as kbd, kanban_db_notify as kbn
        from hermes_cli import kanban_decompose as decomp
        from gateway import kanban_watchers_dispatcher as dispatcher
        self.spawns = []
        for module, name, value in (
            (kb, '_fire_task_hook', lambda *a, **k: None),
            (kb, '_fire_worker_spawned_hook', lambda *a, **k: None),
            (kb, 'notify_task_updated', lambda *a, **k: None),
            (kbd, '_default_spawn', self.spawn),
            (kbd, '_profile_exists_fn', lambda: lambda name: True),
            (kbd, '_memory_pressure_level', lambda: 'normal'),
            (kbd, 'count_running_tasks_other_boards', lambda *a: 0),
            (kbd, 'review_dispatch_enabled', lambda: True),
            (dispatcher, '_default_profile_secret_scope', contextlib.nullcontext),
        ):
            self.stack.enter_context(patch.object(module, name, value))
        self.conn = kbc.connect()
        self.addCleanup(self.conn.close)
        settings = dispatcher._DispatcherSettings(1, 4, 4, 3, 0, False, None, None)
        self.ticker = dispatcher._KanbanDispatcher(kb, settings)
        self.stack.enter_context(patch.object(self.ticker, '_board_slugs', return_value=['default']))
        route = decomp._Routing('controller', 'producer', True, [], {'producer', 'reviewer'})
        self.stack.enter_context(patch.object(decomp, '_load_routing', return_value=route))
        self.aux = self.stack.enter_context(patch.object(decomp, '_call_aux', return_value=(
            json.dumps({'fanout': False, 'title': 'Synthetic specified work', 'body': 'No retry.'}), '')))

    def spawn(self, task, workspace, board=None):
        self.spawns.append((task.id, task.assignee, tuple(task.skills or [])))
        return None  # no PID, subprocess, model, or actual worker

    def create(self, title='Synthetic bounded unit', **kwargs):
        return kb.create_task(self.conn, title=title, body='No retry. Return to controller.',
                              assignee='producer', workspace_kind='scratch', **kwargs)

    def claim(self, tid):
        task = kb.claim_task(self.conn, tid, claimer='producer')
        self.assertIsNotNone(task)
        return kb.get_task(self.conn, tid).current_run_id

    def tick(self):
        result = self.ticker.tick_once_for_board('default')
        self.assertIsNotNone(result, 'dispatcher swallowed an error; inspect raw stderr')
        return result

    def event(self, tid, kind):
        return [e for e in kb.list_events(self.conn, tid) if e.kind == kind][-1]

    def test_repeated_needs_input_and_capability_reach_triage_despite_prose(self):
        for kind in ('needs_input', 'capability'):
            with self.subTest(kind=kind):
                tid = self.create()
                for count in range(1, kb.BLOCK_RECURRENCE_LIMIT + 1):
                    run = self.claim(tid)
                    self.assertTrue(kb.block_task(self.conn, tid, kind=kind,
                        reason='No retry; completed read-only allowance spent', expected_run_id=run))
                    task = kb.get_task(self.conn, tid)
                    self.assertEqual(task.block_recurrences, count)
                    self.assertEqual(task.status, 'triage' if count == kb.BLOCK_RECURRENCE_LIMIT else 'blocked')
                    if count < kb.BLOCK_RECURRENCE_LIMIT:
                        self.assertTrue(kb.unblock_task(self.conn, tid))
                self.assertEqual(self.ticker.auto_decompose_tick(1), 1)
                self.assertEqual(kb.get_task(self.conn, tid).status, 'ready')
                self.assertIn(tid, [row[0] for row in self.tick().spawned])
                # End the fake attempt, preserving the recurrence characterization.
                self.assertTrue(kb.complete_task(self.conn, tid, result='Synthetic unit delivered'))
        self.assertEqual(self.aux.call_count, 2)

    def test_completed_unit_is_terminal_and_acceptance_is_separate(self):
        tid = self.create()
        run = self.claim(tid)
        result = 'Diagnostic delivered; not deployed; AYA acceptance pending'
        self.assertTrue(kb.complete_task(self.conn, tid, result=result, expected_run_id=run))
        task = kb.get_task(self.conn, tid)
        self.assertEqual((task.status, task.block_recurrences, task.block_kind), ('done', 0, None))
        gate, ev = ControllerGate('default'), self.event(tid, 'completed')
        self.assertEqual(gate.receive(self.conn, 'default', ev), 'delivery-pending-controller')
        self.assertEqual(gate.receive(self.conn, 'default', ev), 'duplicate')
        self.assertFalse(gate.accept(self.conn, tid, actor='producer', expected_run=run, expected_result=result))
        self.assertFalse(gate.accept(self.conn, tid, actor='AYA', expected_run=run, expected_result='changed'))
        self.assertFalse(gate.accept(self.conn, tid, actor='AYA', expected_run=run+100, expected_result=result))
        self.assertTrue(gate.accept(self.conn, tid, actor='AYA', expected_run=run, expected_result=result))
        self.assertFalse(kb.complete_task(self.conn, tid, result=result, expected_run_id=run))
        self.assertFalse(kb.block_task(self.conn, tid, kind='needs_input', expected_run_id=run))
        for _ in range(2):
            self.assertEqual(self.ticker.auto_decompose_tick(1), 0)
            self.assertEqual(self.tick().spawned, [])
        self.aux.assert_not_called()

    def test_unfinished_full_phase_and_bra_stay_held(self):
        phase = self.create('Full phase remains unfinished')
        self.claim(phase)
        self.assertTrue(kb.block_task(self.conn, phase, kind='capability', reason='Real coordination defect'))
        held = [self.create(name, parents=[phase], initial_status='blocked') for name in ('B', 'R', 'A')]
        self.assertFalse(kb.request_review(self.conn, phase, summary='Not a passive hold'))
        for _ in range(2):
            self.assertEqual(self.ticker.auto_decompose_tick(1), 0)
            self.assertEqual(self.tick().spawned, [])
        for tid in [phase, *held]:
            self.assertEqual(kb.get_task(self.conn, tid).status, 'blocked')
        self.aux.assert_not_called()

    def test_review_dispatch_is_active_positive_authorized_control(self):
        tid = self.create()
        self.assertIn(tid, [row[0] for row in self.tick().spawned])
        run = kb.get_task(self.conn, tid).current_run_id
        self.assertTrue(kb.block_task(self.conn, tid, kind='needs_input', reason='Synthetic missing input', expected_run_id=run))
        self.assertTrue(kb.unblock_task(self.conn, tid))
        run = self.claim(tid)
        self.assertTrue(kb.request_review(self.conn, tid, summary='Authorized independent review',
                                        reviewer='reviewer', expected_run_id=run))
        self.assertEqual(kb.get_task(self.conn, tid).block_recurrences, 1)
        self.assertIn(tid, [row[0] for row in self.tick().spawned])
        self.assertEqual(self.spawns[-1][1], 'reviewer')
        self.assertIn('sdlc-review', self.spawns[-1][2])
        review_run = kb.get_task(self.conn, tid).current_run_id
        self.assertNotEqual(run, review_run)
        self.assertFalse(kb.complete_task(self.conn, tid, result='Stale producer', expected_run_id=run))
        self.assertFalse(kb.block_task(self.conn, tid, kind='needs_input', expected_run_id=run))
        self.assertTrue(kb.complete_task(self.conn, tid, result='Synthetic review delivered', expected_run_id=review_run))

    def test_notices_deduplicate_cursor_and_stale_events_do_not_authorize(self):
        tid = self.create()
        sub = dict(task_id=tid, platform='synthetic', chat_id='controller')
        kbn.add_notify_sub(self.conn, **sub, delivery_mode='notify+wake')
        run1 = self.claim(tid)
        self.assertTrue(kb.block_task(self.conn, tid, kind='needs_input', reason='Synthetic hold', expected_run_id=run1))
        old, cursor, events = kbn.claim_unseen_events_for_sub(self.conn, **sub, kinds=['blocked', 'completed'])
        self.assertEqual([e.kind for e in events], ['blocked'])
        gate = ControllerGate('default')
        self.assertEqual(gate.receive(self.conn, 'default', events[0]), 'hold')
        self.assertEqual(gate.receive(self.conn, 'default', events[0]), 'duplicate')
        self.assertEqual(kbn.claim_unseen_events_for_sub(self.conn, **sub)[2], [])
        self.assertTrue(kb.unblock_task(self.conn, tid))
        run2 = self.claim(tid)
        self.assertTrue(kb.complete_task(self.conn, tid, result='Only synthetic bounded unit', expected_run_id=run2))
        stale_gate = ControllerGate('default')
        self.assertEqual(stale_gate.receive(self.conn, 'default', events[0]), 'stale')
        _, newer, done = kbn.claim_unseen_events_for_sub(self.conn, **sub, kinds=['completed'])
        self.assertEqual(len(done), 1)
        self.assertFalse(kbn.rewind_notify_cursor(self.conn, **sub, claimed_cursor=cursor, old_cursor=old))
        self.assertTrue(kbn.rewind_notify_cursor(self.conn, **sub, claimed_cursor=newer, old_cursor=cursor))
        replay = kbn.claim_unseen_events_for_sub(self.conn, **sub, kinds=['completed'])[2]
        self.assertEqual(replay[0].id, done[0].id)
        self.assertEqual(stale_gate.receive(self.conn, 'wrong-board', done[0]), 'wrong-board')
        self.assertEqual(stale_gate.receive(self.conn, 'default', done[0]), 'delivery-pending-controller')
        self.assertEqual(stale_gate.receive(self.conn, 'default', replay[0]), 'duplicate')
        # Reopen with the supported status API, then old completion becomes stale.
        self.assertTrue(kb.set_status(self.conn, tid, 'ready'))
        self.claim(tid)
        self.assertEqual(ControllerGate('default').receive(self.conn, 'default', done[0]), 'stale')

    def test_completion_releases_todo_but_not_explicit_block(self):
        parent = self.create('Synthetic narrowed unit')
        todo = self.create('Ungated-by-policy downstream', parents=[parent])
        blocked = self.create('Explicit controller hold', parents=[parent], initial_status='blocked')
        self.claim(parent)
        self.assertTrue(kb.complete_task(self.conn, parent, result='Bounded unit only'))
        self.assertEqual(kb.get_task(self.conn, todo).status, 'ready')
        self.assertEqual(kb.get_task(self.conn, blocked).status, 'blocked')
        self.assertIn(todo, [row[0] for row in self.tick().spawned])
        self.assertNotIn(blocked, [row[0] for row in self.spawns])


if __name__ == '__main__':
    unittest.main(verbosity=2)
