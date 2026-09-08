# Graph Report - multi-agent  (2026-09-08)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1652 nodes · 2927 edges · 111 communities (79 shown, 32 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 59 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7658bb69`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- cn
- taskBoard.ts
- validate_data.py
- app/page.tsx
- gray
- search
- color
- compilerOptions
- button
- slide_search_core.py
- dependencies
- spacing
- search_stack
- scripts/core.py
- TestTailwindConfigGenerator
- design_system.py
- html-token-validator.py
- search
- BM25
- BM25
- DesignSystemGenerator
- GitHubClient
- TailwindConfigGenerator
- dependencies
- llmFactory.ts
- generate-slide.py
- fetch-background.py
- HumanAdapter
- developerAgent.ts
- TestThresholdGate
- graphEngine.ts
- icon/generate.py
- fontSize
- CatalogRefreshTest
- devDependencies
- TestShadcnInstaller
- detect_domain
- .generate
- _palette_is_dark
- extract-colors.cjs
- validate-asset.cjs
- devDependencies
- _select_palette_for_mode
- test_data_contracts.py
- core/types.ts
- github.ts
- validate-tokens.cjs
- ShadcnInstaller
- .check_shadcn_config
- .generate_config_string
- inject-brand-context.cjs
- embed-tokens.cjs
- duration
- patch
- test_tailwind_config_gen.py
- generate_design_system
- orchestratorAgent.ts
- logo/generate.py
- generate-tokens.cjs
- ._base_config
- parse_decision_rules
- test_text_layout_resilience.py
- web/package.json
- sync-brand-to-tokens.cjs
- _run
- radius
- _row_identities
- format_ascii_box
- _filter_anti_patterns_for_mode
- layout.tsx
- sm
- TestLandingAndStackContract
- lg
- xl
- 16
- none
- test_sync_brand_to_tokens.py
- main
- .__init__
- .temp_project
- .test_add_components_already_installed
- .test_list_installed_with_components
- 1
- .test_init_dry_run
- .test_check_shadcn_config_not_exists
- .test_get_installed_components_empty
- .test_add_components_no_components
- .test_add_fonts
- .test_recommend_plugins
- .test_recommend_plugins_nextjs
- .test_init_default_typescript
- .test_generate_javascript_config
- .test_generate_config_with_colors
- .test_generate_config_with_plugins
- .test_validate_config_valid
- .test_validate_config_no_content
- .test_write_config_creates_content
- .test_write_config_invalid_path
- .test_full_configuration_typescript
- .test_default_output_path_typescript
- .test_base_config_structure
- .test_default_content_paths_react
- .test_default_content_paths_vue
- eslint.config.mjs
- next.config.ts
- postcss.config.mjs
- 3
- 8
- @types/node
- .test_add_components_no_config

## God Nodes (most connected - your core abstractions)
1. `TailwindConfigGenerator` - 58 edges
2. `search()` - 43 edges
3. `cn()` - 39 edges
4. `TestTailwindConfigGenerator` - 35 edges
5. `DesignSystemGenerator` - 35 edges
6. `search_stack()` - 35 edges
7. `ShadcnInstaller` - 34 edges
8. `useWorkflowStore` - 31 edges
9. `TestShadcnInstaller` - 26 edges
10. `TaskStatus` - 19 edges

## Surprising Connections (you probably didn't know these)
- `TestTailwindConfigGenerator` --uses--> `TailwindConfigGenerator`  [INFERRED]
  .agents/skills/ui-styling/scripts/tests/test_tailwind_config_gen.py → .agents/skills/ui-styling/scripts/tailwind_config_gen.py
- `TestBm25CoreBehavior` --uses--> `BM25`  [INFERRED]
  .agents/skills/ui-ux-pro-max/scripts/tests/test_core.py → .agents/skills/design/scripts/cip/core.py
- `TestTokenizer` --uses--> `BM25`  [INFERRED]
  .agents/skills/ui-ux-pro-max/scripts/tests/test_core.py → .agents/skills/design/scripts/cip/core.py
- `TestEndToEndCoherence` --uses--> `DesignSystemGenerator`  [INFERRED]
  .agents/skills/ui-ux-pro-max/scripts/tests/test_design_system_mode.py → .agents/skills/ui-ux-pro-max/scripts/design_system.py
- `TestGeneratedConfigIsValidJs` --uses--> `TailwindConfigGenerator`  [INFERRED]
  .agents/skills/ui-styling/scripts/tests/test_tailwind_config_gen.py → .agents/skills/ui-styling/scripts/tailwind_config_gen.py

## Import Cycles
- None detected.

## Communities (111 total, 32 thin omitted)

### Community 0 - "cn"
Cohesion: 0.05
Nodes (80): CardActionButton(), WorkflowEdgeComponent(), workflowEdgeTypes, EditorToolbar(), ToolButton(), FlowCanvas(), NodePalette(), PALETTE_ICON (+72 more)

### Community 1 - "taskBoard.ts"
Cohesion: 0.08
Nodes (64): dynamic, GET(), POST(), TaskActionBody, PRIORITY_RANK, TaskBoardPage(), CreateTaskModal(), CreateTaskModalProps (+56 more)

### Community 2 - "validate_data.py"
Cohesion: 0.08
Nodes (46): read_rows(), TestAccessibilityGuidance, TestChartsTypographyAndIcons, TestCurrentReactGuidance, TestSemanticColors, _catalog_date(), _check_app_interface_contract(), _check_catalog_contract() (+38 more)

### Community 3 - "app/page.tsx"
Cohesion: 0.10
Nodes (30): DashboardPage(), CompletedAndCostSection(), GraphFlowPreview(), nodeTypes, QueueAndFailedSection(), RunningAgentsSection(), StatCards(), Badge() (+22 more)

### Community 4 - "gray"
Cohesion: 0.05
Nodes (53): $type, $value, $type, $value, $type, $value, $type, $value (+45 more)

### Community 5 - "search"
Cohesion: 0.07
Nodes (42): BM25, detect_domain(), get_cip_brief(), _load_csv(), Load CSV and return list of dicts, Core search function using BM25, Auto-detect the most relevant domain from query, Main search function with auto-domain detection (+34 more)

### Community 6 - "color"
Cohesion: 0.04
Nodes (48): $type, $value, background, destructive, destructive-foreground, foreground, muted, muted-foreground (+40 more)

### Community 7 - "compilerOptions"
Cohesion: 0.04
Nodes (46): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+38 more)

### Community 8 - "button"
Cohesion: 0.06
Nodes (45): $type, $value, $type, $value, bg, fg, font-size, hover-bg (+37 more)

### Community 9 - "slide_search_core.py"
Cohesion: 0.08
Nodes (36): format_context(), format_result(), main(), Format a single search result for display, Format contextual recommendations for display., BM25, calculate_pattern_break(), detect_domain() (+28 more)

### Community 10 - "dependencies"
Cohesion: 0.05
Nodes (38): axios, commander, dotenv, inquirer, @langchain/anthropic, @langchain/core, @langchain/google-genai, @langchain/langgraph (+30 more)

### Community 11 - "spacing"
Cohesion: 0.09
Nodes (22): $type, $value, $type, $value, $type, $value, $type, $value (+14 more)

### Community 12 - "search_stack"
Cohesion: 0.11
Nodes (6): Search stack-specific guidelines, search_stack(), _rows(), TestNativeDesktopStackFreshness, _rows(), TestWebStackFreshness

### Community 13 - "scripts/core.py"
Cohesion: 0.09
Nodes (36): _contains_phrase(), _domain_keywords(), _exact_match_diagnostic(), _exact_stack_identifier(), _file_signature(), _get_bm25(), _legacy_successor_guidance(), _load_csv() (+28 more)

### Community 14 - "TestTailwindConfigGenerator"
Cohesion: 0.06
Nodes (16): Test adding colors multiple times., Test adding full color palette., Test adding custom spacing., Test adding custom breakpoints., Test TailwindConfigGenerator class., Test generating TypeScript configuration., Test validating config with empty theme extensions., Test writing configuration to file. (+8 more)

### Community 15 - "design_system.py"
Cohesion: 0.11
Nodes (22): _detect_page_type(), format_master_md(), format_page_override_md(), _generate_intelligent_overrides(), persist_design_system(), Path, _query_wants_dark(), Format design system as MASTER.md with hierarchical override logic. (+14 more)

### Community 16 - "html-token-validator.py"
Cohesion: 0.13
Nodes (24): get_context(), is_allowed_exception(), is_allowed_rgba(), is_inside_block(), load_css_variables(), main(), print_result(), print_summary() (+16 more)

### Community 17 - "search"
Cohesion: 0.12
Nodes (7): Resolve a deprecated in-domain alias, or expose a cross-domain redirect., Main search function with auto-domain detection, search(), _style_search_destination(), TestSearchDomains, read_rows(), TestStyleTaxonomy

### Community 18 - "BM25"
Cohesion: 0.11
Nodes (19): BM25, detect_domain(), _load_csv(), Load CSV and return list of dicts, Core search function using BM25, Auto-detect the most relevant domain from query, Main search function with auto-domain detection, Search across all domains and combine results (+11 more)

### Community 19 - "BM25"
Cohesion: 0.11
Nodes (9): BM25, BM25 ranking algorithm for text search, Lowercase, normalize synonyms, split, remove punctuation, filter stopwords, Build BM25 index from documents, Score all documents against query, All indexed terms, for suggestion/typo-recovery purposes., TestBm25CoreBehavior, TestDiagnosticsContracts (+1 more)

### Community 20 - "DesignSystemGenerator"
Cohesion: 0.16
Nodes (6): DesignSystemGenerator, Generates design system recommendations from aggregated searches., Load reasoning rules from CSV., TestReasoningMatch, read_rows(), TestReasoningContract

### Community 21 - "GitHubClient"
Cohesion: 0.19
Nodes (3): GitHubClient, execAsync, LocalGitClient

### Community 22 - "TailwindConfigGenerator"
Cohesion: 0.10
Nodes (12): main(), Add custom font families. Args: fonts: Dict of font_type: [font_names] e.g.,…, Add custom spacing values. Args: spacing: Dict of name: value e.g., {'18':…, Add custom breakpoints. Args: breakpoints: Dict of name: width e.g., {'3xl':…, Add plugin requirements. Args: plugins: List of plugin names e.g.,…, Get plugin recommendations based on configuration. Returns: List of recommended…, Generate Tailwind CSS configuration files., Validate configuration. Returns: Tuple of (valid, message) (+4 more)

### Community 23 - "dependencies"
Cohesion: 0.10
Nodes (21): dependencies, class-variance-authority, clsx, lucide-react, next, react, react-dom, tailwind-merge (+13 more)

### Community 24 - "llmFactory.ts"
Cohesion: 0.20
Nodes (6): AnthropicProvider, defaultFactory, GoogleProvider, LLMFactory, LLMProvider, OpenAIProvider

### Community 25 - "generate-slide.py"
Cohesion: 0.15
Nodes (19): _e(), generate_chart_slide(), generate_cta_slide(), generate_deck(), generate_metrics_slide(), generate_problem_slide(), generate_solution_slide(), generate_testimonial_slide() (+11 more)

### Community 26 - "fetch-background.py"
Cohesion: 0.17
Nodes (17): generate_css_for_background(), get_background_image(), get_curated_images(), get_overlay_css(), get_pexels_search_url(), load_backgrounds_config(), load_brand_colors(), main() (+9 more)

### Community 27 - "HumanAdapter"
Cohesion: 0.23
Nodes (5): HumanAdapter, WorkflowState, DocGeneratorAgent, DocumentFormatter, MarkdownDocumentFormatter

### Community 28 - "developerAgent.ts"
Cohesion: 0.19
Nodes (5): CodeGenerator, LLMCodeGenerator, DeveloperAgent, VersionControlClient, LocalGitConfig

### Community 29 - "TestThresholdGate"
Cohesion: 0.13
Nodes (3): TestFixtureValidation, TestMetricMath, TestThresholdGate

### Community 30 - "graphEngine.ts"
Cohesion: 0.20
Nodes (6): CLIHumanAdapter, AgentGraphEngine, Tracer, WorkflowAnnotation, Agent, program

### Community 31 - "icon/generate.py"
Cohesion: 0.20
Nodes (15): apply_color(), apply_viewbox_size(), extract_svgs(), generate_batch(), generate_icon(), generate_sizes(), load_env(), main() (+7 more)

### Community 32 - "fontSize"
Cohesion: 0.12
Nodes (16): $type, $value, $type, $value, $type, $value, $type, $value (+8 more)

### Community 34 - "devDependencies"
Cohesion: 0.15
Nodes (13): devDependencies, eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, @types/react, @types/react-dom, eslint (+5 more)

### Community 35 - "TestShadcnInstaller"
Cohesion: 0.14
Nodes (8): Test adding components in dry run mode., Test ShadcnInstaller class., Test listing installed components without config., Test listing installed components when none exist., Test initialization with default project root., Test checking for existing shadcn config., Test getting installed components without config., TestShadcnInstaller

### Community 36 - "detect_domain"
Cohesion: 0.23
Nodes (3): detect_domain(), Auto-detect the most relevant domain from query. Matches are weighted by…, TestDomainDetection

### Community 37 - ".generate"
Cohesion: 0.14
Nodes (8): Execute searches across multiple domains., Find matching reasoning rule for a category., Apply reasoning rules to search results., Select best matching result based on priority keywords., Extract results list from search result dict., Generate complete design system recommendation. variance/motion/density are…, Bucket a 1-10 dial value into its tier config. Returns None if value is None., _resolve_dial()

### Community 38 - "_palette_is_dark"
Cohesion: 0.18
Nodes (7): _palette_is_dark(), WCAG relative luminance of a #RRGGBB string, or None if unparseable., True when a colors.csv row's Background is a dark surface., _relative_luminance(), The exact reproduction from issue #428., TestEndToEndCoherence, TestLuminance

### Community 39 - "extract-colors.cjs"
Cohesion: 0.22
Nodes (11): calculateCompliance(), colorDistance(), displayPalette(), extractHexColors(), findNearestBrandColor(), fs, generateImageMagickCommand(), hexToRgb() (+3 more)

### Community 40 - "validate-asset.cjs"
Cohesion: 0.25
Nodes (13): checkManifest(), formatBytes(), formatOutput(), fs, main(), parseFilename(), path, RULES (+5 more)

### Community 41 - "devDependencies"
Cohesion: 0.14
Nodes (14): typescript, jest, devDependencies, jest, ts-jest, ts-node, @types/inquirer, @types/jest (+6 more)

### Community 42 - "_select_palette_for_mode"
Cohesion: 0.22
Nodes (7): _contrast_ratio(), _derive_dark_palette(), WCAG contrast ratio for two hex colors, or None if either is invalid., Keep product brand tokens while deriving accessible dark surfaces., Pick the highest-ranked palette matching the resolved mode. Only the dark case…, _select_palette_for_mode(), TestPaletteSelection

### Community 43 - "test_data_contracts.py"
Cohesion: 0.24
Nodes (4): split_values(), style_identities(), TestGeneratedCatalogContract, TestStyleIdentityContract

### Community 44 - "core/types.ts"
Cohesion: 0.21
Nodes (6): getLLM(), ProjectMode, VcsMode, GenerateCodeOptions, ClassifiedIntent, LLMIntentClassifier

### Community 45 - "github.ts"
Cohesion: 0.16
Nodes (5): GitHubConfig, GitHubIssue, GitHubRepository, LangFuseConfig, LangFuseTracer

### Community 46 - "validate-tokens.cjs"
Cohesion: 0.24
Nodes (11): extensions, formatReport(), fs, getFiles(), main(), parseArgs(), path, patterns (+3 more)

### Community 47 - "ShadcnInstaller"
Cohesion: 0.20
Nodes (7): main(), Handle shadcn/ui component installation., ShadcnInstaller, Tests for shadcn_add.py, Test adding all components without config., Test initialization with custom project root., Test getting installed components when files exist.

### Community 48 - ".check_shadcn_config"
Cohesion: 0.21
Nodes (6): Add all available shadcn/ui components. Args: overwrite: If True, overwrite…, List installed components. Returns: Tuple of (success, message with component…, Check if shadcn is initialized in project. Returns: True if components.json…, Get list of already installed components. Returns: List of installed component…, Read shadcn version from project package.json; fall back to a pinned default., Add shadcn/ui components. Args: components: List of component names to add…

### Community 49 - ".generate_config_string"
Cohesion: 0.20
Nodes (6): Generate configuration file content. Returns: Configuration file as string, Generate TypeScript configuration., Generate JavaScript configuration., Format plugins array for config. Validates each plugin name against a strict…, Add indentation to JSON string., Write configuration to file. Returns: Tuple of (success, message)

### Community 50 - "inject-brand-context.cjs"
Cohesion: 0.31
Nodes (10): extractColorsFromTable(), extractCoreAttributes(), extractHexColors(), extractImageStyle(), extractTypography(), extractVoice(), fs, generatePromptAddition() (+2 more)

### Community 51 - "embed-tokens.cjs"
Cohesion: 0.18
Nodes (8): args, fs, minimal, MINIMAL_TOKENS, path, projectRoot, tokensPath, wrapStyle

### Community 52 - "duration"
Cohesion: 0.20
Nodes (10): fast, normal, slow, $type, $value, $type, $value, duration (+2 more)

### Community 53 - "patch"
Cohesion: 0.18
Nodes (6): Test adding components with overwrite flag., Test successful component addition., Test component addition with subprocess error., Test component addition when npx is not found., Test successful addition of all components., patch

### Community 54 - "test_tailwind_config_gen.py"
Cohesion: 0.22
Nodes (8): Tests for tailwind_config_gen.py, Reduce a generated TS/JS config to a bare assignable object so it can be handed…, Regression guard for the missing-comma bug between the ``theme`` block and…, The property preceding ``plugins`` must end with a comma (pure-Python check, so…, The emitted config parses as valid JS via ``node --check``., _strip_to_object(), TestGeneratedConfigIsValidJs, parametrize

### Community 55 - "generate_design_system"
Cohesion: 0.20
Nodes (7): format_markdown(), generate_design_system(), Format design system as markdown., Main entry point for design system generation. Args: query: Search query (e.g.,…, format_output(), Format results for Claude consumption (token-optimized), TestPersistence

### Community 56 - "orchestratorAgent.ts"
Cohesion: 0.24
Nodes (5): DocumentEvaluator, LLMDocumentEvaluator, IntentClassifier, OrchestratorAgent, IssueTrackerClient

### Community 57 - "logo/generate.py"
Cohesion: 0.29
Nodes (9): enhance_prompt(), generate_batch(), generate_logo(), load_env(), main(), Enhance the logo prompt with style and industry modifiers, Generate a logo using Gemini models with image generation Args: aspect_ratio:…, Generate multiple logo variants with different styles (+1 more)

### Community 58 - "generate-tokens.cjs"
Cohesion: 0.36
Nodes (9): flattenTokens(), fs, generateCSS(), generateTailwind(), main(), parseArgs(), path, resolveReference() (+1 more)

### Community 59 - "._base_config"
Cohesion: 0.22
Nodes (6): Path, Initialize generator. Args: typescript: If True, generate .ts config, else .js…, Determine default output path., Create base configuration structure., Get default content paths for framework., Any

### Community 60 - "parse_decision_rules"
Cohesion: 0.27
Nodes (6): apply_decision_rules(), _object_without_duplicates(), parse_decision_rules(), Return deterministic mutations and an audit trail; never execute data., Parse the canonical condition -> action-array representation., _validate_action()

### Community 61 - "test_text_layout_resilience.py"
Cohesion: 0.22
Nodes (3): read_rows(), TestTextLayoutDataContracts, TestTextLayoutRetrieval

### Community 62 - "web/package.json"
Cohesion: 0.20
Nodes (9): name, packageManager, private, scripts, build, dev, lint, start (+1 more)

### Community 63 - "sync-brand-to-tokens.cjs"
Cohesion: 0.33
Nodes (8): adjustBrightness(), { execFileSync }, extractColorsFromMarkdown(), fs, generateColorScale(), main(), path, updateDesignTokens()

### Community 64 - "_run"
Cohesion: 0.28
Nodes (8): Path, Regression tests for validate-tokens.cjs. The validator used to skip any line…, A hardcoded hex on the same line as a var() token is still a violation., A line that references only tokens produces no false positives., _run(), test_flags_hardcoded_hex_sharing_line_with_token(), test_token_only_line_reports_no_violation(), CompletedProcess

### Community 65 - "radius"
Cohesion: 0.19
Nodes (14): $type, $value, $type, $value, $type, $value, primitive, radius (+6 more)

### Community 66 - "_row_identities"
Cohesion: 0.25
Nodes (8): _exact_row_identity(), Suggest complete public identities so a retry can bypass score thresholds., Return non-empty public identities from ordinary and alias fields., Resolve an explicit style identity without opening generic variant ranking., Return one row whose stable public identity exactly matches the query., _row_identities(), _style_identity(), _suggest_identities()

### Community 67 - "format_ascii_box"
Cohesion: 0.25
Nodes (8): ansi_ljust(), format_ascii_box(), hex_to_ansi(), Convert hex color to ANSI True Color swatch (██) with fallback., Like str.ljust but accounts for zero-width ANSI escape sequences., Create a Unicode section separator: ├─── NAME ───...┤, Format design system as Unicode box with ANSI color swatches., section_header()

### Community 68 - "_filter_anti_patterns_for_mode"
Cohesion: 0.43
Nodes (3): _filter_anti_patterns_for_mode(), Drop "avoid dark mode" advice once dark mode is the resolved answer., TestAntiPatternGating

### Community 69 - "layout.tsx"
Cohesion: 0.33
Nodes (4): geistMono, geistSans, metadata, QueryProvider()

### Community 70 - "sm"
Cohesion: 0.60
Nodes (5): sm, sm, sm, $type, $value

### Community 72 - "lg"
Cohesion: 0.60
Nodes (5): lg, $type, $value, lg, lg

### Community 73 - "xl"
Cohesion: 0.67
Nodes (4): xl, xl, $type, $value

### Community 74 - "16"
Cohesion: 0.67
Nodes (3): $type, $value, 16

### Community 75 - "none"
Cohesion: 0.67
Nodes (4): $type, $value, none, none

### Community 82 - "1"
Cohesion: 0.67
Nodes (3): $type, $value, 1

### Community 107 - "3"
Cohesion: 0.67
Nodes (3): $type, $value, 3

### Community 108 - "8"
Cohesion: 0.67
Nodes (3): $type, $value, 8

### Community 109 - "@types/node"
Cohesion: 0.67
Nodes (3): @types/node, @types/node, @types/node

## Knowledge Gaps
- **245 isolated node(s):** `ConditionBranch`, `WorkflowEdgeKind`, `WorkflowNodeConfig`, `WorkflowNodeMeta`, `IssueBuilder` (+240 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **32 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `search()` connect `search` to `_row_identities`, `validate_data.py`, `detect_domain`, `.generate`, `scripts/core.py`, `design_system.py`, `BM25`, `generate_design_system`, `test_text_layout_resilience.py`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `primitive` connect `radius` to `fontSize`, `gray`, `color`, `spacing`, `duration`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `BM25` connect `search` to `BM25`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `TailwindConfigGenerator` (e.g. with `TestGeneratedConfigIsValidJs` and `TestTailwindConfigGenerator`) actually correct?**
  _`TailwindConfigGenerator` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `DesignSystemGenerator` (e.g. with `TestReasoningMatch` and `TestReasoningContract`) actually correct?**
  _`DesignSystemGenerator` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `ConditionBranch`, `WorkflowEdgeKind`, `WorkflowNodeConfig` to the rest of the system?**
  _245 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `cn` be split into smaller, more focused modules?**
  _Cohesion score 0.05171717171717172 - nodes in this community are weakly interconnected._