# Code Review Guide

A checklist and reference for reviewing code changes in the PocketLab Notebook monorepo. Used by a reviewer Claude Code agent.

## Review Process

When reviewing changes:

1. **Identify what changed** — determine which files and class types are affected
2. **Check conventions** — naming, formatting, imports, class structure
3. **Check for anti-patterns** — the specific issues listed in the Checklist section
4. **Check logic** — correctness, edge cases, missing error handling
5. **Check tests** — are they present, adequate, following patterns from `testing.md`

---

## Class Types & Naming Conventions

### Angular App (`services/app`)

| Class Type | Suffix | Naming Pattern | File Pattern | Example |
|------------|--------|---------------|-------------|---------|
| Component | `Component` | `NounVerbComponent` | `noun-verb.component.ts` | `ClassEditComponent` |
| Directive | `Directive` | `FunctionDirective` | `function.directive.ts` | `AutofocusDirective` |
| Store | `Store` | `NounStore` | `noun.store.ts` | `EntryStore` |
| Action | `Action` | `VerbNounAction` | `verb-noun.action.ts` | `CreateCourseAction` |
| PolicyService | `PolicyService` | `VerbNounPolicyService` | `verb-noun-policy.service.ts` | `ActAsTeacherPolicyService` |
| AuthGuardService | `AuthGuardService` | — | — | (not used — auth is via policies) |
| Strategy | `Strategy` | `NounVerbStrategy` | `noun-verb-strategy.ts` | `CurriculumChildDestinationStrategy` |
| Factory | `Factory` | `NounFactory` | `noun-factory.ts` | `AppNotebookFactory` |
| Reactor | `Reactor` | `NounReactor` | `noun.reactor.ts` | `EntryReactor` |

### Backend Services

| Class Type | Suffix | Naming Pattern | File Pattern | Example |
|------------|--------|---------------|-------------|---------|
| Domain | `Domain` | `VerbNounDomain` | `verb-noun-domain.ts` | `FetchMasterDomain` |
| Strategy | `Strategy` | `NounVerbStrategy` | `noun-verb-strategy.ts` | `GooglePostConfirmStrategy` |
| Task | `Task` | `VerbNounTask` | `verb-noun-task.ts` | `MigrateExistingDAUserTask` |
| JobStrategy | `Strategy` (implements `JobStrategy`) | `VerbNounStrategy` | `verb-noun-strategy.ts` | `CopyLRToAStrategy` |
| Factory | `Factory` or `Builder` | `NounFactory` | `noun-factory.ts` | `DomainBuilder` |
| Lambda Handler | — (exported functions) | `verbHandler` | `noun-lambda-actions.ts` | `eventHandler` |

### Common Utils

| Class Type | Suffix | Naming Pattern | File Pattern | Example |
|------------|--------|---------------|-------------|---------|
| Visitor | `Visitor` | `NounVisitor` | `noun-visitor.ts` | `IndexManagerVisitor` |
| IndexManager | `IndexManager` | `NounIndexManager` | `noun-index-manager.ts` | `MasterIndexManager` |
| Adapter | `Adapter` | `SourceToTargetAdapter` | `source-to-target-adapter.ts` | `LabReportEntryToSearchResultAdapter` |
| Validator | `Validator` / `ValidatorFactory` | `NounValidator` | `noun-validator.ts` | `LenientValidator` |
| Policy | `Policy` | — | — | (validator-adjacent) |

### General Naming Rules

- **Classes:** PascalCase, always suffixed with class type
- **Utility functions:** `verbNoun` (e.g. `editClass`, `generateSortKey`)
- **Callbacks:** `nounPastParticiple` (e.g. `classEdited`, `entryCopied`)
- **Variables, methods:** camelCase starting with lowercase
- **Private instance variables** (not constructor-injected): prefix with `_` (e.g. `_destroyed$`, `_state$`)
- **Enums:** PascalCase names and values (e.g. `EntryType.LabReport`)
- **Observables and signals:** suffix with `$` (e.g. `user$`, `state$`)
- **Model interfaces:** suffix with `Entry` for entries, `SectionEntry` for sections
- **Type aliases** for entries with same shape but different semantic meaning: `export type NewEntry = ExistingEntry`

---

## Formatting Conventions

### General

- **Indentation:** 2 spaces, no tabs
- **Quotes:** Single quotes `'` everywhere (TypeScript, templates, SCSS). Double quotes only for strings nested inside single quotes
- **Max line length:** 140 characters
- **Empty lines:** Maximum 2 consecutive empty lines
- **Commented code:** Remove all commented-out code. Only keep descriptive comments
- **Semicolons:** Required

### Imports

```typescript
// 1. Framework imports (Angular, RxJS)
import {Injectable, OnDestroy} from '@angular/core';
import {Observable, BehaviorSubject, ReplaySubject} from 'rxjs';
import {map, filter, takeUntil} from 'rxjs/operators';

// 2. Third-party library imports
import {TranslateService} from '@ngx-translate/core';

// 3. Common/shared library imports
import * as PL2 from '@common/utils/dist/models/models-pl2.js';
import * as APIM from '@common/utils/dist/models/api-messages.js';
import {KeyUtilsPL2 as KU} from '@common/utils/dist/utils/key-utils-pl2.js';

// 4. Local imports (stores, services, actions, components, utils)
import {EntryStore} from '@stores/entry.store';
import {UserStore} from '@stores/user.store';
```

**Rules:**
- Group by type/library, separated by an empty line
- Order from framework → third-party → shared → local (top of stack → bottom)
- No whitespace inside single-import curly brackets: `{Injectable}` not `{ Injectable }`
- Multi-import curly brackets: each import on its own line, alphabetical order
- **Never import paths containing `/src/`** — use path aliases (`@stores/`, `@services/`, etc.)

### Backend Import Aliases

Standard aliases used across all backend services:

```typescript
import * as APIM from '@common/utils/dist/models/api-messages.js';
import * as PL2 from '@common/utils/dist/models/models-pl2.js';
import {UtilsPL2 as U} from '@common/utils/dist/utils/utils-pl2.js';
import {KeyUtilsPL2 as KU} from '@common/utils/dist/utils/key-utils-pl2.js';
import {EntryUtilsPL2 as EU} from '@common/utils/dist/utils/entry-utils-pl2.js';
import * as RTNG from '@common/ext-service-utils-v2/dist/routing/routing.js';
```

### Templates

- After the tag name and the first attribute, all subsequent attributes go on a new line aligned with the first attribute
- Closing angle bracket on the same line as the last attribute, no space before `>`
- Use single quotes for attribute values in templates
- Use `class` bindings instead of `ngClass`
- Use `style` bindings instead of `ngStyle`
- Use native control flow (`@if`, `@for`, `@switch`) instead of `*ngIf`, `*ngFor`, `*ngSwitch`
- Custom directive selectors use `pl` prefix

```html
<button mat-button
        class='primary-action'
        [disabled]='isLoading'
        (click)='handleClick()'>
  {{ 'i18n.key' | translate }}
</button>
```

### Angular Decorators & Lifecycle

- `@Input()`, `@Output()`, `@ViewChild()` — variable on the line BELOW the decorator, not inline
- Prefer `input()` and `output()` signal functions over decorators in new code
- `@ViewChild`/`@ViewChildren` — use type and selector rather than template variable where possible
- **Do NOT use `@HostBinding` or `@HostListener`** — use the `host` object in `@Component`/`@Directive` decorator instead
- Lifecycle methods in framework call order: `ngOnInit`, `ngOnChanges`, `ngAfterContentInit`, `ngAfterViewInit`, `ngOnDestroy`
- All lifecycle methods directly below the constructor

### Logging (Backend Services)

```typescript
// Format: [ClassName.methodName] message
console.log('[FetchMasterDomain.fetch] processing entries');
console.error('[MigrateExistingDAUserTask.migrate] No class code provided');

// Lambda handlers alternative format:
console.error('[entry-lambda-actions#eventHandler] ' + err);
```

- Use `error` sparingly (triggers alarms)
- Prefer `debug` for detailed trace logging
- Always prefix with class/file and method name

---

## Architecture Patterns to Enforce

### Stores (Angular)

```typescript
@Injectable({providedIn: 'root'})
export class MyStore extends Store<MyState> implements OnDestroy {
  private _destroyed$ = new ReplaySubject<boolean>();

  constructor() {
    super(initialState);
  }

  // State modifications ALWAYS through setState() or modifyStateWithTransformer()
  // Never mutate state directly
  // Use immer's produce() for complex state transformations
}
```

**Rules:**
- Stores extend `Store<S>` (from `abstract-store.ts`)
- `state$` is `Observable<S>` (public, read-only)
- `state()` returns current value synchronously
- `setState(nextState)` emits new state
- `modifyStateWithTransformer(data, transformer)` for immutable updates
- **Never mutate state inside an RxJS pipe operator** — always call `setState()` explicitly

### Actions

```typescript
@Injectable()
export class VerbNounAction implements Action<InputType, OutputType> {
  constructor(private store: SomeStore, ...) {}

  execute(input: InputType): Observable<OutputType> {
    // Thin — delegate to stores/services
  }
}
```

- `@Injectable()` (not `providedIn: 'root'`)
- Implement `Action<I, O>` (async) or `SynchronousAction<I, O>` (sync)
- Keep thin — business logic belongs in stores and domains

### Policies

```typescript
@Injectable()
export class ActAsNounPolicyService implements ActionPolicy {
  constructor(private userStore: UserStore) {}

  can$(pK?: string): Observable<boolean> {
    return this.userStore.state$.pipe(
      map(user => /* boolean based on CURRENT USER */)
    );
  }
}
```

**Critical Rule: `ActAs*` policies must check the current user as the subject.** The `pK` parameter is for context (which entry is being acted upon), but the subject being authorized is always the current user from `UserStore`. Policies like `ActAsStudentCopyPolicyService` that check entry type rather than user role are a known anti-pattern — they should be named differently (e.g. `IsStudentCopyPolicyService`) or refactored.

### Reactors

```typescript
@Injectable({providedIn: 'root'})
export class NounReactor implements OnDestroy {
  private _destroyed$ = new ReplaySubject<boolean>();

  constructor(private store: SomeStore) {
    this.store.state$.pipe(
      // operators...
      takeUntil(this._destroyed$),  // ALWAYS last operator
    ).subscribe(/* side effects */);
  }

  ngOnDestroy() {
    this._destroyed$.next(true);
    this._destroyed$.complete();
  }
}
```

- Side-effect managers that subscribe to store observables
- **Always use `takeUntil(this._destroyed$)` as the last pipe operator**
- Implement `OnDestroy` with `_destroyed$.next(true)` + `_destroyed$.complete()`

### Domains (Backend)

```typescript
export class VerbNounDomain {
  constructor(
    private docClient: DynamoDBDocument,
    private tableName: string,
  ) {}

  verb(input: InputType): Promise<OutputType> {
    // DynamoDB operations
  }
}
```

- Single responsibility
- Constructor injection of AWS clients
- Methods return `Promise<T>`
- Type-safe DynamoDB operations (`PutCommandInput`, `QueryCommandInput`)

### Components (Angular)

- Prefer `standalone: true` for new components
- Set `changeDetection: ChangeDetectionStrategy.OnPush`
- Use `input()` and `output()` functions instead of decorators
- Use `computed()` for derived state
- Use `inject()` function instead of constructor injection (new code)

---

## Review Checklist

### Critical Issues (Must Fix)

- [ ] **No signal `effect()` usage** — `effect()` should not be used. Use explicit subscriptions with `takeUntil` cleanup instead. Known violations exist in `shimmer.directive.ts` and `list.component.ts` — do not add more
- [ ] **No `/src/` in import paths** — all imports must use path aliases (`@stores/`, `@services/`, `@common/utils/dist/`, etc.)
- [ ] **No circular dependencies** — check that new imports don't create circular references between modules/services
- [ ] **No store state mutation in RxJS pipes** — state changes must go through `setState()` or `modifyStateWithTransformer()`, never inside `map()`, `tap()`, `switchMap()`, etc. operating on the same store's observable. Exception: `tap()` calling `setState()` on a *different* store is acceptable (but prefer doing it in subscribe)
- [ ] **`takeUntil` on all subscriptions** — every `.subscribe()` in components, reactors, and services must have `takeUntil(this._destroyed$)` as the last pipe operator. Only exception: one-shot observables that complete naturally (e.g. HTTP requests, `first()`)
- [ ] **Policy subject correctness** — `ActAs*` policies must authorize based on the current user, not on entry type or other non-user attributes. If a policy checks entry type, it should not be named `ActAs*`

### Import Issues

- [ ] No unused imports
- [ ] Imports grouped by type (framework → third-party → shared → local) with empty line separators
- [ ] No whitespace inside single-import curly brackets
- [ ] Multi-import curly brackets: imports on separate lines, alphabetical order
- [ ] No `import ... from 'rxjs/Rx'` (use specific imports)
- [ ] Backend: `.js` extensions on all relative imports

### Naming Issues

- [ ] Classes suffixed with their type (`Component`, `Store`, `Action`, `PolicyService`, `Domain`, etc.)
- [ ] Class names: Noun + Verb pattern (e.g. `ClassEditComponent`, not `EditClassComponent`)
- [ ] Utility functions: Verb + Noun pattern (e.g. `editClass`)
- [ ] Callbacks: Noun + Past Participle (e.g. `classEdited`)
- [ ] Private non-constructor variables prefixed with `_`
- [ ] Observables/signals suffixed with `$`
- [ ] Enum names and values PascalCase
- [ ] Model interfaces: `Entry` suffix for entries, `SectionEntry` for sections
- [ ] File names: kebab-case matching the class name pattern

### Formatting Issues

- [ ] 2-space indentation, no tabs (check both TypeScript and templates)
- [ ] Single quotes everywhere (TypeScript, templates, SCSS)
- [ ] No more than 2 consecutive empty lines
- [ ] No commented-out code (only descriptive comments allowed)
- [ ] Template attributes: first attr on tag line, subsequent attrs on new lines aligned with first, closing `>` on same line as last attr
- [ ] Line length ≤ 140 characters

### Angular-Specific Issues

- [ ] No `@HostBinding` or `@HostListener` decorators — use `host` object in `@Component`/`@Directive`
- [ ] No `ngClass` — use `class` bindings
- [ ] No `ngStyle` — use `style` bindings
- [ ] Prefer native control flow (`@if`, `@for`, `@switch`) over structural directives (`*ngIf`, `*ngFor`)
- [ ] No `mutate` on signals — use `update` or `set`
- [ ] Lifecycle methods in framework call order, directly below constructor
- [ ] `@Input()` / `@Output()` / `@ViewChild()` decorators on line above variable, not inline
- [ ] New components should be `standalone: true` with `ChangeDetectionStrategy.OnPush`
- [ ] Use `input()` / `output()` functions for new components instead of decorators
- [ ] Use `inject()` function for new code instead of constructor injection
- [ ] Reactive forms preferred over template-driven forms

### RxJS Issues

- [ ] No `subscribe()` without `takeUntil` in long-lived objects (components, services, reactors)
- [ ] No nested subscribes — use `switchMap`, `mergeMap`, `concatMap` instead
- [ ] No store state mutation inside `pipe()` operators on that store's own observable
- [ ] Use `async` pipe in templates where possible
- [ ] No `rxjs/Rx` barrel import

### Code Smell Checks

- [ ] No `any` type where a proper type can be inferred or defined
- [ ] No empty `catch` blocks
- [ ] No logic in constructors beyond dependency injection and simple initialization (move to `ngOnInit`)
- [ ] No business logic in components — delegate to actions, stores, or services
- [ ] Single responsibility — each class does one thing
- [ ] No dead code (unreachable branches, unused variables, unused methods)
- [ ] Error handling present at system boundaries (user input, API calls)
- [ ] Logging in backend code uses `[ClassName.methodName]` prefix format
- [ ] No console.log in production frontend code (use console.warn/error/debug only)

### Backend-Specific Issues

- [ ] Domain classes are single-responsibility
- [ ] DynamoDB operations use typed command inputs (`PutCommandInput`, `QueryCommandInput`)
- [ ] Promises have `.catch()` handlers or are in try-catch blocks
- [ ] Lambda handlers follow the `(event, context, callback)` signature pattern
- [ ] Event intent mapping in `generateEntryIntent` is correct for new entry types
- [ ] EventBridge rules in `event-bus-rules.yaml` are added for new event intents
- [ ] S3 is used for large payloads (>200KB threshold)

### Test Coverage

- [ ] New code has corresponding spec files
- [ ] Spec files follow patterns from `testing.md`
- [ ] Angular: uses `Setup.buildComponent2()` / `buildInjectable2()` pattern
- [ ] Angular: uses `SDU.buildFrequentStubData()` for test data
- [ ] Angular: uses `CallRecords` for verifying method calls (not Jasmine spies)
- [ ] Backend: uses `sinon.mock()` + `setupAWSMock()` for DynamoDB
- [ ] Backend: uses `Test.dbStub()` and other shared stubs
- [ ] Backend: `mock.verify()` in `afterEach()`
- [ ] Tests actually reach their assertions (check `done()` is called, `fakeAsync` uses `flush()`/`tick()`)

---

## Common Anti-Patterns to Flag

### 1. State Mutation in Pipe

**Bad:**
```typescript
this.store.state$.pipe(
  tap(state => {
    state.someProperty = newValue;  // Direct mutation!
  })
);
```

**Good:**
```typescript
this.store.state$.pipe(
  tap(() => {
    this.store.setState({...this.store.state(), someProperty: newValue});
  })
);
// Or better yet, do it in subscribe or a separate method
```

### 2. Missing takeUntil

**Bad:**
```typescript
export class MyComponent implements OnInit {
  ngOnInit() {
    this.store.state$.pipe(
      map(s => s.value)
    ).subscribe(v => this.handle(v));  // Memory leak!
  }
}
```

**Good:**
```typescript
export class MyComponent implements OnInit, OnDestroy {
  private _destroyed$ = new ReplaySubject<boolean>();

  ngOnInit() {
    this.store.state$.pipe(
      map(s => s.value),
      takeUntil(this._destroyed$),
    ).subscribe(v => this.handle(v));
  }

  ngOnDestroy() {
    this._destroyed$.next(true);
    this._destroyed$.complete();
  }
}
```

### 3. Signal Effect Usage

**Bad:**
```typescript
effect(() => {
  this.applyStyle(this.myInput());
});
```

**Good:**
```typescript
// Use explicit subscription or computed()
myComputed = computed(() => this.calculateStyle(this.myInput()));
```

### 4. Wrong Policy Subject

**Bad** — `ActAs*` policy checking entry type instead of user:
```typescript
export class ActAsStudentCopyPolicyService implements ActionPolicy {
  can$(pPK: string): Observable<boolean> {
    return this.entryStore.state$.pipe(
      map(() => this.entryStore.state()[pPK]?.e.t === EntryType.StudentCopy)
    );
  }
}
```

**Better naming** — if it checks entry, don't name it `ActAs*`:
```typescript
export class IsStudentCopyPolicyService implements ActionPolicy { ... }
```

### 5. Import Path with /src/

**Bad:**
```typescript
import {MyService} from '../../../src/app/services/my.service';
```

**Good:**
```typescript
import {MyService} from '@services/my.service';
```

### 6. Circular Dependencies

Watch for circular imports between:
- Stores that import each other
- Services that import components that import the same service
- Actions that import other actions
- Policies that import stores that import policies

### 7. Nested Subscribes

**Bad:**
```typescript
this.store.state$.subscribe(state => {
  this.otherService.getData(state.id).subscribe(data => {
    this.handle(data);
  });
});
```

**Good:**
```typescript
this.store.state$.pipe(
  switchMap(state => this.otherService.getData(state.id)),
  takeUntil(this._destroyed$),
).subscribe(data => this.handle(data));
```

---

## Key Source Files for Reviewers

| File | Why It Matters |
|------|---------------|
| `services/app/src/app/stores/abstract-store.ts` | Base store pattern — 35 lines, defines all state management |
| `services/app/src/app/directives/policy/action-policy.ts` | ActionPolicy interface — 7 lines, defines policy contract |
| `common/utils/src/models/api-messages.ts` (lines 367-439) | EventIntent enum — all event types |
| `common/utils/src/models/models-pl2.ts` (lines 270-323) | EntryType enum — all entry type codes |
| `services/events/stacks/event-bus-rules.yaml` | EventBridge routing — verify new intents have rules |
| `services/entries/src/utils/generate-entry-intent.ts` | Intent mapping — verify new types are mapped |
| `services/app/src/app/app.module.ts` (lines 155-183) | Decorator chain wiring — understand event flow |
| `sort_key_and_entry_hierarchy.md` | Sort key structure — verify key operations are correct |
| `event_system_and_project_structure.md` | Event system — verify event flow is correct |
| `testing.md` | Test patterns — verify tests follow conventions |
