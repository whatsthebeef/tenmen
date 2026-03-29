# Testing Guide

A reference guide for understanding and writing tests across the PocketLab Notebook monorepo. Intended for use by Claude Code agents when developing, testing, and reviewing code.

## Quick Reference: Commands by Project

| Project | Test Command | Build & Test | Watch | Framework |
|---------|-------------|--------------|-------|-----------|
| `services/app` | `cd services/app && yarn test` | `yarn build-and-test` | `yarn test-watch` | Jasmine 3.6 + Karma |
| `common/utils` | `cd common/utils && yarn test` | `yarn cbt` | — | Jasmine 5.1 |
| `common/ble` | `cd common/ble && yarn test` | `yarn cbt` | — | Jasmine 5.1 |
| `services/entries` | `cd services/entries && yarn test` | `yarn cbt` | — | Jasmine 4.3 |
| `services/ai` | `cd services/ai && yarn test` | `yarn cbt` | — | Jasmine 4.3 |
| `services/websocket` | `cd services/websocket && yarn test` | `yarn cbt` | — | Jasmine 4.3 |
| `services/notifications` | `cd services/notifications && yarn test` | `yarn cbt` | — | Jasmine 4.3 |
| `services/users` | `cd services/users && yarn test` | `yarn cbt` | — | Jasmine 4.3 |
| `services/auth` | `cd services/auth && yarn test` | `yarn cbt` | — | Jasmine 4.3 |
| `services/payments` | `cd services/payments && yarn test` | `yarn cbt` | — | Jasmine 4.3 |
| `services/etl` | — | — | — | Tests disabled |
| `common/ble` (single) | `cd common/ble && yarn test -- -spec=<filename>` | — | — | Jasmine 5.1 |

**`cbt`** = Clean, Build, Test (runs `clean && build && test` in sequence).

**App-specific commands:**

```bash
cd services/app
yarn test                    # Run tests with codebuild karma config
yarn test-watch              # Run tests in watch mode (Chrome)
yarn test-watch-headless     # Run tests in watch mode (ChromeHeadless)
```

## Two Testing Worlds

The codebase has two distinct testing patterns:

1. **Angular App** (`services/app`) — Jasmine + Karma with custom test-bed utilities, `CallRecords`, stub factories, and the `Setup` module
2. **Backend Services & Common Packages** — Jasmine + Sinon with direct mocking, `sinon.mock()`/`sinon.stub()`, and `SetupAWSInterfaceMock`

---

# Part 1: Angular App Testing (`services/app`)

## Configuration

- **Framework:** Jasmine 3.6.0 + Karma task runner
- **Browser:** Chrome (ChromeHeadless for CI)
- **Timeout:** 210 seconds (karma.conf.js)
- **Coverage:** HTML + lcov reports
- **TypeScript:** Path aliases (`@models/*`, `@services/*`, `@stores/*`, `@components/*`, `@actions/*`, `@utils/*`, `@test/*`) defined in `src/tsconfig.spec.json`

## Core Test Utilities

### File Overview

| File | Purpose |
|------|---------|
| `src/app/test-utils.ts` | `Setup` module — component/injectable/directive builders, DOM helpers, custom matchers |
| `src/app/stub-utils.ts` | `StubUtils` module — `StubFactory`, `StubDataHolder`, provider replacement functions |
| `src/app/stub-data-utils.ts` | `StubDataUtils` module — pre-built stub data for all common stores and services |
| `src/app/call-records.ts` | `CallRecords` class — records method invocations on stubs for assertion |

### CallRecords

The custom spy/observation system used instead of Jasmine spies. Every stubbed service method automatically records its calls.

```typescript
class CallRecords {
  add(callDetails: {f: string, args: any[]})  // Record a call
  all()                    // Get all recorded calls
  clear()                  // Clear call history
  last(fnName?: string)    // Last call (optionally filtered by function name)
  first(fnName?: string)   // First call (optionally filtered)
  none()                   // True if no calls recorded
  at(index: number)        // Get call at index (supports negative indexing)
  includes(f: string)      // True if function was ever called
  get(f: string)           // Get all calls to a specific function
}
```

**Usage in assertions:**

```typescript
expect(records.includes('sendEvent')).toBeTrue();
expect(records.last('setState').args[0]).toEqual(expectedState);
expect(records.first('delete').args).toEqual([entryId]);
expect(records.get('open').length).toBe(2);
expect(records.none()).toBeTrue();
```

### StubFactory

Creates stubs for any class/service, wrapping all methods to log calls to `CallRecords`:

```typescript
const stubFactory = new SU.StubFactory();

// Generic stub — wraps all methods on the prototype with recording + return values
const stub = stubFactory.buildStub(
  MyService.prototype,           // prototype to stub
  records,                       // CallRecords instance
  { doSomething: of(someValue) } as StubData<MyService>  // optional return values
);

// Store stub — adds state$, state(), setState() support
const storeStub = stubFactory.buildStoreStub(
  MyStore.prototype,
  records,
  stubData.get(MyStore)
);

// Entry store stub — adds modifyStateWithTransformer() on top of store stub
const entryStoreStub = stubFactory.buildEntryStoreStub(
  EntryStore.prototype,
  records,
  stubData.get(EntryStore)
);
```

**How `buildStub` works internally:**
1. Creates a copy of the prototype
2. Overlays any provided `StubData` values
3. Wraps every method: logs `{f: methodName, args}` to `records`, then returns the StubData value
4. Optionally runs an `init` callback for custom setup

### StubDataHolder

Type-safe registry for test data, keyed by class/service type:

```typescript
const stubData = SDU.buildFrequentStubData({
  u: TU.buildUser(),
  cr: cr({e: TU.buildLr(), c: [{e: TU.buildTextSection()}]}),
});

stubData.get(EntryStore)     // Get EntryStore stub data
stubData.get(UserStore)      // Get UserStore stub data
stubData.has(CustomStore)    // Check if data exists
stubData.put(CustomStore, myStubData)  // Register custom stub data
stubData.getSortedKeys()     // Extract {pK, cPKs} from EntryStore state
```

### buildFrequentStubData — The Primary Entry Point

This is the main function used to set up test data. It creates stub data for all commonly needed stores and services:

```typescript
const stubData = SDU.buildFrequentStubData({
  u?: User,                    // User (defaults to a basic user)
  cr?: EntryCreateRequest,     // Entry hierarchy to populate EntryStore
  routeState?: Partial<RouteState>,  // Route state overrides
  overwritePK?: string,        // Override primary key
  decisions?: AppDecisions,    // Feature flag decisions
});
```

**What it sets up:**
- `EntryStore` — populated from `cr` (create request) parameter
- `UserStore` — populated from `u` parameter
- `RouteStore` — populated from `routeState` parameter
- `EventAPIService` — default stub returning `of(void 0)`
- `WebsocketService`, `ServiceCommsWrapperService` — default stubs
- `APIService`, `EntryApiService`, `HttpService` — default stubs
- `MatDialog`, `MatDialogRef` — dialog stubs
- `WindowSizeStore`, `APIStateStore`, `GeolocationStore` — store stubs
- `ActiveEventStore`, `WebsocketStatusStore`, `ActiveAPIServiceStore` — store stubs
- `AppDecisionsBuilder`, `DialogRendererService` — stubs
- `TranslateService` — uses real English translations from `en.json`
- `WINDOW`, `DOCUMENT`, `STORAGE` — browser API stubs

### Provider Replacement Functions

```typescript
// Replace ALL commonly needed providers in one call
const config = SU.replaceFrequentProviders(stubData, moduleConfig, stubFactory, records);

// Add additional custom provider overrides
const config = SU.replaceProviders(
  [{ provide: CustomService, useFactory: () => stubFactory.buildStub(...) }],
  SU.replaceFrequentProviders(stubData, moduleConfig, stubFactory, records)
);
```

`replaceFrequentProviders` replaces these providers in the module config:
- `WebsocketService`, `ServiceCommsWrapperService`, `DatePipe`, `WindowSizeStore`
- `S3Service`, `APIStateStore`, `TranslateService`, `APIService`
- `MatDialogRef`, `MatDialog`, `UserStore`, `EntryStore`, `RouteStore`
- `EntryApiService`, `ActiveAPIServiceStore`, `AppDecisionsBuilder`
- `DialogRendererService`, `EventAPIServiceToken`
- `HttpService`, `HttpClient`, `BluetoothConnectionService`
- `GeolocationStore`, `CacheExpirationStrategyService`
- `ActiveEventStore`, `WebsocketStatusStore`
- `WINDOW`, `DOCUMENT`, `STORAGE` injection tokens

### Setup Module — Building Test Subjects

#### Testing Components

```typescript
// Modern pattern (preferred)
const fixture = Setup.buildComponent2(
  MyComponent,
  moduleConfig   // after replaceFrequentProviders
);

// Standalone components
const fixture = Setup.buildComponentStnd(
  MyStandaloneComponent,
  moduleConfig
);

// Old pattern (returns tuple)
const [ids, fixture, records] = Setup.buildComponent(state, moduleConfig, variables);
```

#### Testing Injectables (Services, Actions)

```typescript
// Modern pattern (preferred)
const service = Setup.buildInjectable2(
  MyService,
  [Dep1, Dep2, Dep3],    // dependency order MUST match constructor order
  moduleConfig
);
```

**Important:** The `dependencies` array order MUST match the constructor parameter order.

#### Testing Directives

```typescript
// Standard directive
const fixture = Setup.buildDirective2(MyDirective, moduleConfig);

// Standalone directive
const fixture = Setup.buildDirectiveStnd(MyStandaloneDirective, moduleConfig);
```

### DOM Helper Functions

Available from `test-utils.ts` for component testing:

```typescript
// Interaction
click(fixture, selector)              // Click an element
select(fixture, selector, value)      // Select dropdown value
keydown(fixture, selector, key)       // Dispatch keydown event
keyup(fixture, selector, key)
mousedown(fixture, selector)
mouseEnter(fixture, selector)
mouseLeave(fixture, selector)
setInputValue(fixture, selector, value)

// Assertions
hasElement(fixture, selector)                    // Element exists
hasExactlyNElements(fixture, selector, n)        // Exactly n elements
hasText(fixture, selector, text)                 // Exact text match
containsText(fixture, selector, text)            // Partial text match
hasInputText(fixture, selector, text)            // Input value match
hasAttribute(fixture, selector, attr, value)     // Attribute value
isDisabled(fixture, selector)                    // Disabled state
isChecked(fixture, selector)                     // Checked state
isHidden(fixture, selector)                      // Display: none
hasStyle(fixture, selector, style, value)        // Inline style
hasClass(fixture, selector, className)           // CSS class
hasFocus(fixture, selector)                      // Focus state

// Overlay (for Material overlays/dialogs outside component DOM)
overlayHasExactlyNElements(fixture, selector, n)
overlayHasText(fixture, selector, text)
```

### Test Data Builder Helpers

```typescript
// Entry hierarchy builder
cr({e: TU.buildLr(), c: [{e: TU.buildTextSection()}]})  // EntryCreateRequest shorthand

// Build entry state from containers
Setup.buildEntryStateFromRequest(createRequest)
Setup.buildEntryStateWithContainerEntries(container)

// Build data visualization config
Setup.buildDataConfigState({
  'pl1bar-alt': { p: [[0, 1], [0.1, 2], [0.2, 3]] }
})

// Build cached entry for store
buildCachedEntry(entry)
buildEntryState({entries...})
buildKey(mId, sK)
getPK(entry)
getEntry(fixture, pK)
```

## Angular App Test Patterns

### Pattern 1: Component Test

```typescript
describe('MyComponent', () => {
  let records: CallRecords;
  let stubFactory: SU.StubFactory;

  const moduleConfig: Setup.ModuleConfig = {
    declarations: [MyComponent],
    imports: [NoopAnimationsModule, MatButtonModule],
    providers: [EntryStore, RouteStore, UserStore],
  };

  beforeEach(() => {
    records = new CallRecords();
    stubFactory = new SU.StubFactory();
  });

  it('renders the component', fakeAsync(() => {
    const stubData = SDU.buildFrequentStubData({
      u: TU.buildUser(),
      cr: cr({e: TU.buildLr(), c: [{e: TU.buildTextSection()}]}),
    });

    const fixture = Setup.buildComponent2(MyComponent, buildModule(stubData));

    fixture.detectChanges();
    flush();

    expect(hasElement(fixture, '.my-selector')).toBeTruthy();
    expect(hasText(fixture, 'h1', 'Expected Title')).toBeTruthy();
  }));

  function buildModule(stubData: SU.StubDataHolder): Setup.ModuleConfig {
    return SU.replaceFrequentProviders(stubData, moduleConfig, stubFactory, records);
  }
});
```

### Pattern 2: Injectable/Action Test

```typescript
describe('MyAction', () => {
  let records: CallRecords;
  let stubFactory: SU.StubFactory;

  const moduleConfig: Setup.ModuleConfig = {
    declarations: [],     // Not needed for injectables
    imports: [],          // Not needed for injectables
    providers: [],
  };

  // Order MUST match constructor parameter order
  const dependencies = [UserStore, EntryStore, DumbEventAPIService];

  beforeEach(() => {
    records = new CallRecords();
    stubFactory = new SU.StubFactory();
  });

  it('sends an event', (done) => {
    const stubData = SDU.buildFrequentStubData({u: TU.buildUser()});

    const action = Setup.buildInjectable2(
      MyAction,
      dependencies,
      buildModule(stubData),
    );

    action.execute().subscribe(() => {
      expect(records.includes('sendEvent')).toBeTrue();
      expect(records.first('sendEvent').args[0].eventType).toBe(EventIntent.EntryCreate);
      done();
    });
  });

  function buildModule(stubData: SU.StubDataHolder): Setup.ModuleConfig {
    return SU.replaceProviders(
      [{
        provide: DumbEventAPIService,
        useFactory: () => stubFactory.buildStub(
          DumbEventAPIService.prototype, records, stubData.get(DumbEventAPIService),
        ),
      }],
      SU.replaceFrequentProviders(stubData, moduleConfig, stubFactory, records),
    );
  }
});
```

### Pattern 3: Store Test

```typescript
describe('MyStore', () => {
  let records: CallRecords;
  let stubFactory: SU.StubFactory;

  const moduleConfig: Setup.ModuleConfig = {
    declarations: [],
    imports: [],
    providers: [],
  };

  beforeEach(() => {
    records = new CallRecords();
    stubFactory = new SU.StubFactory();
  });

  it('updates state correctly', fakeAsync(() => {
    const store = Setup.buildInjectable2(
      MyStore,
      [],
      SU.replaceFrequentProviders(
        new SU.StubDataHolder({}),
        moduleConfig, stubFactory, records,
      ),
    );

    store.doSomething(input);
    tick();

    expect(store.state().someProperty).toEqual(expectedValue);
  }));
});
```

### Pattern 4: Policy Service Test

```typescript
describe('MyPolicy', () => {
  let records: CallRecords;
  let stubFactory: SU.StubFactory;

  // CallRecords and StubFactory are created but not heavily used
  // The main pattern is subscribe + done callback

  it('allows the action', (done) => {
    const stubData = SDU.buildFrequentStubData({u: TU.buildUser()});

    const policy = Setup.buildInjectable2(
      MyPolicy,
      [UserStore, EntryStore],
      buildModule(stubData),
    );

    policy.can$(entry).subscribe((allowed) => {
      expect(allowed).toBeTrue();
      done();
    });
  });
});
```

### Important Patterns & Conventions

1. **Always use `fakeAsync()` + `flush()`/`tick()`** for component tests with async operations
2. **Use `done` callback** for Observable-based assertions (actions, policies, services)
3. **`buildModule()` helper function** — define a local `buildModule(stubData)` function per describe block for DRY test setup
4. **Route state** — set via `stubData.get(RouteStore).state$.next({containerId: ...})` before building component
5. **No teardown** — the codebase does not use `afterEach()` for cleanup (only one instance exists)
6. **`NoopAnimationsModule`** — import when the component uses Angular animations

---

# Part 2: Backend & Common Package Testing

## Configuration

All backend services and common packages share a consistent setup:

- **Framework:** Jasmine (4.3.1 for services, 5.1.0 for common packages)
- **Mocking:** Sinon 9.0.3
- **Spec Pattern:** `dist/**/*.spec.js` (compiled from TypeScript)
- **Execution:** Randomized order
- **Reporter:** `jasmine-spec-reporter` with PRETTY stack traces
- **Default Timeout:** 5000ms
- **Module System:** ES2020 modules (`.js` extensions in imports)

### Build Flow

```bash
yarn cbt                     # Standard: clean → build → test

# Equivalent to:
yarn clean                   # rm -rf dist/ tsconfig.tsbuildinfo
yarn build                   # tsc --build tsconfig.json
yarn test                    # jasmine --config=jasmine.json
```

**Important:** Specs must be compiled before running. Jasmine reads from `dist/`, not `src/`. Always run `yarn build` (or `yarn cbt`) after changing test files.

### Jasmine Configuration

All services share essentially the same `jasmine.json`:

```json
{
  "spec_dir": "dist",
  "spec_files": ["**/*.spec.js"],
  "helpers": ["**/test/reporter.js"],
  "oneFailurePerSpec": true,
  "random": true
}
```

## Shared Test Utilities

### TestUtilsPL2 (TU) — `common/utils/src/test/utils-pl2.ts`

Entry and data builders used across all projects:

```typescript
import {TestUtilsPL2 as TU} from '@common/utils/dist/test/utils-pl2.js';

// Constants
TU.uId          // 'userId'
TU.mId          // 'masterId'
TU.aDate        // '1550421001523'
TU.cC           // 'classCode'
TU.sId          // 'studentId'

// Pre-built sort keys
TU.cSK0         // '00001234'          (class sort key)
TU.aSK0         // '00001234030000'    (assignment sort key)
TU.sCSK0        // '00001234030000020000' (student copy sort key)
TU.lRSK0        // '00010000'          (lab report sort key)

// User builders
TU.buildUser()           // Lite user
TU.buildStudent()        // Student user
TU.buildPro()            // Pro user
TU.buildSuperUser()      // Super user with auth permissions
TU.buildLiteUser()       // Lite user with liteId

// Entry builders
TU.buildEntry(type, parentSK?)           // Generic entry
TU.buildLr(attrs?)                       // Lab report
TU.buildClass(attrs?)                    // Class
TU.buildAssignment(attrs?)               // Assignment
TU.buildStudentCopy(attrs?)              // Student copy
TU.buildTextSection(attrs?)              // Text section
TU.buildDataAnalysisSection(attrs?)      // Data analysis section
TU.buildQuestionSection(attrs?)          // Question section
TU.buildVideoSection(attrs?)             // Video section
TU.buildImageSection(attrs?)             // Image section
TU.buildCourse(attrs?)                   // Course
TU.buildCurriculum(attrs?)               // Curriculum
TU.buildStudentUser(attrs?)              // Student user entry
TU.buildLabReportUser(attrs?)            // Lab report user entry
TU.buildLicense(attrs?)                  // License entry
TU.buildAnswer(attrs?)                   // Answer entry
TU.buildComment(attrs?)                  // Comment entry
// ... and more for every entry type

// Key builders
TU.sK(entryType, parentSK?, random?)     // Generate sort key
TU.pK(entryType, parentPK?, random?)     // Generate primary key
```

### SetupAWSInterfaceMock — `common/utils/src/test/setup-aws-interface-mock.ts`

Fluent builder for DynamoDB mock expectations (wraps sinon.mock):

```typescript
import * as AWSU from '@common/utils/dist/test/setup-aws-interface-mock.js';

const mock = sinon.mock(db);

AWSU.setupAWSMock(mock, {tableName: 'myTable'})
  .get({key: {mId, sK}, item: expectedItem})                  // Expect get, return item
  .put({item: entryToStore})                                    // Expect put
  .query({args: queryParams, items: [item1, item2]})            // Expect query, return items
  .query({args: otherParams, items: [], lastEvaluatedKey: key}) // Paginated query
  .delete({key: {mId, sK}})                                    // Expect delete
  .update({key, exp: 'SET #n = :v', vals: {':v': value}})      // Expect update
  .batchWrite({requestItems: {...}})                            // Expect batch write
  .batchGet({args: {...}, response: {...}})                     // Expect batch get

// After domain execution:
mock.verify();  // Assert all expectations were met
```

**Error simulation:**

```typescript
AWSU.setupAWSMock(mock, {tableName: 'myTable'})
  .query({error: 'DynamoDB error'})         // Simulate query error
  .put({item: entry, err: 'PutItem failed'}) // Simulate put error
```

### ext-service-utils-v2 Test Stubs — `common/ext-service-utils-v2/src/test.ts`

Pre-built stubs for common backend dependencies:

```typescript
import * as Test from '@common/ext-service-utils-v2/dist/test.js';

Test.dbStub()                  // DynamoDB client stub (put, get, query, delete, etc.)
Test.asyncOutputHolderStub()   // AsyncOutputHolder stub (addOutput, getOutput, addError, etc.)
Test.errorSinkStub()           // ErrorSink stub (error, debug)
Test.httpClientStub()          // HTTP client stub (post, get)
Test.secretsManagerStub()      // SecretsManager stub (callback-based getSecretValue)
Test.secretsManagerClientStub() // SecretsManager stub (promise-based send)
Test.cispStub()                // Cognito Identity Provider stub
Test.queryParamsF(defaults)    // Factory for building QueryCommandInput
Test.testSubject(fn, done, onSuccess?, onError?)  // Async test helper
```

### testSubject Helper

Simplifies promise-based test assertions:

```typescript
Test.testSubject(
  () => domain.execute(input),   // async operation
  done,                           // jasmine done callback
  (result) => {                   // success handler
    expect(result).toEqual(expected);
  },
  (err) => {                      // error handler (optional)
    expect(err.code).toBe(500);
  },
);
```

## Backend Test Patterns

### Pattern 1: Simple Utility/Function Test

```typescript
import {myFunction} from './my-utils.js';

describe('myFunction', () => {
  it('returns expected result', () => {
    const result = myFunction(input);
    expect(result).toEqual(expected);
  });
});
```

### Pattern 2: Domain with DynamoDB (Sinon Mock)

```typescript
import sinon from 'sinon';
import * as Test from '@common/ext-service-utils-v2/dist/test.js';
import * as AWSU from '@common/utils/dist/test/setup-aws-interface-mock.js';
import {TestUtilsPL2 as TU} from '@common/utils/dist/test/utils-pl2.js';

describe('MyDomain', () => {
  let db: any;
  let mock: sinon.SinonMock;

  beforeEach(() => {
    db = Test.dbStub();
  });

  afterEach(() => {
    if (mock) mock.verify();   // Verify all mock expectations
  });

  it('reads and processes entries', (done) => {
    mock = sinon.mock(db);
    const entry = TU.buildLr();

    AWSU.setupAWSMock(mock, {tableName: 'entriesTable'})
      .get({key: {mId: entry.mId, sK: entry.sK}, item: entry})
      .query({args: queryParams, items: [child1, child2]});

    new MyDomain(db, 'entriesTable')
      .execute({mId: entry.mId, sK: entry.sK})
      .then((result) => {
        expect(result.length).toBe(2);
        done();
      });
  });

  it('handles errors', (done) => {
    mock = sinon.mock(db);

    AWSU.setupAWSMock(mock, {tableName: 'entriesTable'})
      .get({key: {mId: 'bad', sK: 'bad'}, item: null});

    new MyDomain(db, 'entriesTable')
      .execute({mId: 'bad', sK: 'bad'})
      .then(
        () => { fail('should have rejected'); done(); },
        (err) => { expect(err).toBeDefined(); done(); },
      );
  });
});
```

### Pattern 3: Domain with AsyncOutputHolder

```typescript
describe('MyCreateDomain', () => {
  let db: any;
  let outputHolder: any;
  let mock: sinon.SinonMock;

  beforeEach(() => {
    db = Test.dbStub();
    outputHolder = Test.asyncOutputHolderStub();
  });

  afterEach(() => {
    if (mock) mock.verify();
  });

  it('creates entry and adds to output', (done) => {
    mock = sinon.mock(db);
    sinon.stub(outputHolder, 'addOutput').returns(Promise.resolve());

    AWSU.setupAWSMock(mock, {tableName: 'myTable'})
      .put({item: expectedEntry});

    new MyCreateDomain(db, 'myTable', outputHolder)
      .run(inputData)
      .then(() => {
        expect((outputHolder.addOutput as sinon.SinonStub).calledWith([expectedEntry])).toBeTrue();
        done();
      });
  });
});
```

### Pattern 4: BLE/Hardware Testing (Jasmine Spies)

```typescript
describe('MyProcessor', () => {
  let processor: MyProcessor;
  let mockDependency: jasmine.SpyObj<SomeDependency>;

  beforeEach(() => {
    mockDependency = jasmine.createSpyObj('SomeDependency', ['process', 'reset']);
    processor = new MyProcessor(mockDependency);
  });

  it('processes data correctly', () => {
    mockDependency.process.and.returnValue([{type: 'Reading', values: [[42]]}]);

    const result = processor.process(inputData);

    expect(result.length).toBe(1);
    expect(mockDependency.process).toHaveBeenCalledTimes(1);
    expect(mockDependency.process).toHaveBeenCalledWith(jasmine.any(DataView));
  });
});
```

### Pattern 5: Auth/External Service Testing

```typescript
describe('ValidateTokenDomain', () => {
  let smStub: SecretsManager;
  let axStub: AxiosInstance;

  beforeEach(() => {
    smStub = Test.secretsManagerStub();
    axStub = Test.httpClientStub() as AxiosInstance;
  });

  it('validates a token', (done) => {
    // Direct function assignment for stubs
    axStub.get = () => Promise.resolve({data: jwkKey} as any);
    smStub.getSecretValue = ((_p, f) =>
      f(null, {SecretString: '{"iss": "https://example.com"}'})
    ) as any;

    new ValidateTokenDomain(smStub, axStub, null)
      .validate(request)
      .then(
        (result) => { expect(result.userId).toBeDefined(); done(); },
        (err) => { fail(err); done(); },
      );
  });
});
```

## Async Testing Patterns

### Angular App (fakeAsync/tick/flush)

```typescript
it('handles async operations', fakeAsync(() => {
  const fixture = Setup.buildComponent2(MyComponent, config);
  fixture.detectChanges();
  tick(100);                    // Advance virtual time by 100ms
  flush();                      // Flush all pending async operations
  fixture.detectChanges();
  expect(hasElement(fixture, '.loaded')).toBeTruthy();
}));
```

### Backend Services (done callback)

```typescript
it('processes asynchronously', (done) => {
  domain.execute(input).then(
    (result) => {
      expect(result).toEqual(expected);
      done();
    },
    (err) => {
      fail(err);
      done();
    },
  );
});
```

### Observable subscribe + done

```typescript
it('emits expected value', (done) => {
  service.getData$().subscribe((value) => {
    expect(value).toEqual(expected);
    done();
  });
});
```

**Warning:** Ensure the subscription actually executes. Use a boolean guard if needed:

```typescript
it('reaches the expectation', (done) => {
  let executed = false;
  service.getData$().subscribe((value) => {
    executed = true;
    expect(value).toEqual(expected);
    done();
  });
  // Safety check if subscribe never fires
  setTimeout(() => {
    if (!executed) { fail('subscribe was not executed'); done(); }
  }, 1000);
});
```

## Entry Hierarchy Test Data Setup

### Building a Class with Assignments

```typescript
const stubData = SDU.buildFrequentStubData({
  u: TU.buildUser(),
  cr: cr({
    e: TU.buildClass(),
    c: [
      {
        e: TU.buildAssignment(),
        c: [
          {e: TU.buildTextSection()},
          {e: TU.buildQuestionSection()},
          {
            e: TU.buildStudentCopy(),
            c: [
              {e: TU.buildTextSection()},
            ],
          },
        ],
      },
      {e: TU.buildStudentUser()},
    ],
  }),
});
```

### Building a Lab Report

```typescript
const stubData = SDU.buildFrequentStubData({
  cr: cr({
    e: TU.buildLr(),
    c: [
      {e: TU.buildTextSection()},
      {e: TU.buildDataAnalysisSection()},
      {e: TU.buildVideoSection()},
    ],
  }),
});
```

### Accessing Built Keys

```typescript
const {pK, cPKs} = stubData.getSortedKeys();
// pK   = primary key of root entry (shortest sort key)
// cPKs = child primary keys sorted by sort key length
```

## Key Source Files Reference

| File | Purpose |
|------|---------|
| `services/app/src/app/test-utils.ts` | Setup module, DOM helpers, custom matchers (1,118 lines) |
| `services/app/src/app/stub-utils.ts` | StubFactory, StubDataHolder, provider replacement (608 lines) |
| `services/app/src/app/stub-data-utils.ts` | Pre-built stub data for all stores/services (850+ lines) |
| `services/app/src/app/call-records.ts` | CallRecords class (46 lines) |
| `services/app/karma.conf.js` | Karma test runner config |
| `services/app/src/tsconfig.spec.json` | TypeScript spec config with path aliases |
| `common/utils/src/test/utils-pl2.ts` | TestUtilsPL2 — entry/user builders, constants |
| `common/utils/src/test/setup-aws-interface-mock.ts` | SetupAWSInterfaceMock — DynamoDB mock builder |
| `common/ext-service-utils-v2/src/test.ts` | Backend stubs (db, output holder, secrets manager, etc.) |
| `common/utils/src/test/reporter.ts` | Jasmine spec reporter config |

## Common Pitfalls

1. **Backend tests must be compiled first** — run `yarn build` or `yarn cbt`, not just `yarn test` after changing `.ts` files
2. **Dependency order matters** — `Setup.buildInjectable2()` dependencies array must match constructor parameter order exactly
3. **Mock verification** — always call `mock.verify()` in `afterEach()` when using sinon mocks to catch missed expectations
4. **Observable completion** — ensure `done()` is always called in subscribe/then handlers, including error paths
5. **Entry state setup** — use `cr()` helper with proper entry hierarchy; the sort keys encode parent-child relationships
6. **StubDataHolder.get()** throws if no data exists — use `.has()` to check first, or `.put()` to add custom data
7. **fakeAsync zone** — component tests should use `fakeAsync()` + `flush()`/`tick()` for async operations
8. **No Jasmine spies in app** — use `CallRecords` pattern instead (check `records.includes()`, `records.last()`, etc.)
9. **ETL has no tests** — `services/etl` test script is `echo 'do nothing'`
10. **Entries service uses `NODE_OPTIONS='--trace-warnings'`** — helps catch unhandled promise rejections
