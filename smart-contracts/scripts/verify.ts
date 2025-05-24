import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { 
  Connection, 
  PublicKey,
  AccountInfo,
  GetProgramAccountsFilter,
  Commitment,
  ConfirmOptions
} from "@solana/web3.js";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import chalk from "chalk";
import axios from "axios";
import crypto from "crypto";

// Verification configuration
interface VerificationConfig {
  network: "devnet" | "mainnet-beta" | "localnet";
  rpcUrl: string;
  explorerUrl: string;
  programs: ProgramVerificationConfig[];
  retryAttempts: number;
  retryDelay: number;
  commitment: Commitment;
  enableSecurityAudit: boolean;
  auditRules: SecurityRule[];
}

interface ProgramVerificationConfig {
  name: string;
  programId: string;
  idlPath: string;
  sourceCodePath?: string;
  expectedVersion?: string;
  skipExplorerVerification?: boolean;
  customValidation?: ValidationRule[];
}

interface ValidationRule {
  name: string;
  check: (program: Program, accountInfo: AccountInfo<Buffer>) => Promise<boolean>;
  description: string;
  severity: "info" | "warning" | "error";
}

interface SecurityRule {
  name: string;
  check: (programData: Buffer, idl: any) => Promise<SecurityIssue[]>;
  description: string;
}

interface SecurityIssue {
  severity: "low" | "medium" | "high" | "critical";
  type: string;
  description: string;
  location?: string;
  recommendation: string;
}

interface VerificationResult {
  programId: string;
  programName: string;
  success: boolean;
  checks: CheckResult[];
  securityIssues: SecurityIssue[];
  metadata: ProgramMetadata;
  error?: string;
}

interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
  severity: "info" | "warning" | "error";
  details?: any;
}

interface ProgramMetadata {
  deploymentSlot?: number;
  lastModified?: number;
  dataSize: number;
  owner: string;
  executable: boolean;
  rentEpoch?: number;
  programDataAccount?: string;
  upgradeAuthority?: string;
  version?: string;
}

interface ExplorerData {
  exists: boolean;
  verified: boolean;
  metadata?: any;
  transactions?: any[];
  error?: string;
}

class ProgramVerifier {
  private connection: Connection;
  private config: VerificationConfig;
  private verificationResults: Map<string, VerificationResult> = new Map();
  private provider: AnchorProvider;

  constructor(config: VerificationConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, {
      commitment: config.commitment,
      confirmTransactionInitialTimeout: 60000,
    });
    
    // Create a minimal provider for program loading
    this.provider = new AnchorProvider(
      this.connection,
      {} as any, // No wallet needed for verification
      { commitment: config.commitment }
    );
    anchor.setProvider(this.provider);
  }

  async verifyPrograms(): Promise<Map<string, VerificationResult>> {
    console.log(chalk.blue("🔍 Starting program verification process..."));
    console.log(chalk.gray(`Network: ${this.config.network}`));
    console.log(chalk.gray(`Programs to verify: ${this.config.programs.length}`));
    
    for (const programConfig of this.config.programs) {
      await this.verifyProgram(programConfig);
    }
    
    // Generate verification report
    await this.generateVerificationReport();
    
    return this.verificationResults;
  }

  private async verifyProgram(config: ProgramVerificationConfig): Promise<void> {
    console.log(chalk.blue(`\n🔍 Verifying program: ${config.name}`));
    console.log(chalk.gray(`Program ID: ${config.programId}`));
    
    const result: VerificationResult = {
      programId: config.programId,
      programName: config.name,
      success: false,
      checks: [],
      securityIssues: [],
      metadata: {
        dataSize: 0,
        owner: "",
        executable: false,
      },
    };
    
    try {
      const programId = new PublicKey(config.programId);
      
      // 1. Basic program account validation
      await this.validateProgramAccount(programId, result);
      
      // 2. IDL validation
      await this.validateIDL(config, result);
      
      // 3. Program upgrade verification
      await this.verifyProgramUpgrade(programId, result);
      
      // 4. Explorer verification
      if (!config.skipExplorerVerification) {
        await this.verifyOnExplorer(programId, result);
      }
      
      // 5. Custom validation rules
      if (config.customValidation) {
        await this.runCustomValidation(config, result);
      }
      
      // 6. Security audit
      if (this.config.enableSecurityAudit) {
        await this.runSecurityAudit(config, result);
      }
      
      // 7. Source code verification (if available)
      if (config.sourceCodePath) {
        await this.verifySourceCode(config, result);
      }
      
      // Determine overall success
      result.success = result.checks.every(check => 
        check.passed || check.severity !== "error"
      ) && result.securityIssues.every(issue => 
        issue.severity !== "critical"
      );
      
      console.log(
        result.success 
          ? chalk.green(`✅ ${config.name} verification passed`)
          : chalk.red(`❌ ${config.name} verification failed`)
      );
      
    } catch (error) {
      result.error = error.toString();
      result.checks.push({
        name: "General Verification",
        passed: false,
        message: `Verification failed: ${error}`,
        severity: "error",
      });
      
      console.error(chalk.red(`❌ ${config.name} verification error:`, error));
    }
    
    this.verificationResults.set(config.programId, result);
  }

  private async validateProgramAccount(
    programId: PublicKey, 
    result: VerificationResult
  ): Promise<void> {
    console.log(chalk.blue("🔍 Validating program account..."));
    
    const accountInfo = await this.retryOperation(async () => {
      return await this.connection.getAccountInfo(programId);
    }, "Failed to fetch program account");
    
    if (!accountInfo) {
      result.checks.push({
        name: "Program Account Existence",
        passed: false,
        message: "Program account does not exist",
        severity: "error",
      });
      return;
    }
    
    // Update metadata
    result.metadata = {
      dataSize: accountInfo.data.length,
      owner: accountInfo.owner.toBase58(),
      executable: accountInfo.executable,
      rentEpoch: accountInfo.rentEpoch,
    };
    
    // Check if account is executable
    result.checks.push({
      name: "Program Executable",
      passed: accountInfo.executable,
      message: accountInfo.executable 
        ? "Program is executable" 
        : "Program is not executable",
      severity: accountInfo.executable ? "info" : "error",
    });
    
    // Check owner (should be BPF Loader or BPF Loader Upgradeable)
    const validOwners = [
      "BPFLoader2111111111111111111111111111111111", // BPF Loader
      "BPFLoaderUpgradeab1e11111111111111111111111", // BPF Loader Upgradeable
    ];
    
    const isValidOwner = validOwners.includes(accountInfo.owner.toBase58());
    result.checks.push({
      name: "Program Owner",
      passed: isValidOwner,
      message: `Program owner: ${accountInfo.owner.toBase58()}`,
      severity: isValidOwner ? "info" : "warning",
      details: { owner: accountInfo.owner.toBase58() },
    });
    
    // Check data size
    result.checks.push({
      name: "Program Size",
      passed: accountInfo.data.length > 0,
      message: `Program size: ${accountInfo.data.length} bytes`,
      severity: "info",
      details: { sizeBytes: accountInfo.data.length },
    });
    
    console.log(chalk.green("✅ Program account validation completed"));
  }

  private async validateIDL(
    config: ProgramVerificationConfig,
    result: VerificationResult
  ): Promise<void> {
    console.log(chalk.blue("🔍 Validating IDL..."));
    
    try {
      if (!fs.existsSync(config.idlPath)) {
        result.checks.push({
          name: "IDL File Existence",
          passed: false,
          message: `IDL file not found: ${config.idlPath}`,
          severity: "error",
        });
        return;
      }
      
      const idlContent = fs.readFileSync(config.idlPath, "utf8");
      const idl = JSON.parse(idlContent);
      
      // Validate IDL structure
      const requiredFields = ["version", "name", "instructions"];
      const missingFields = requiredFields.filter(field => !idl[field]);
      
      result.checks.push({
        name: "IDL Structure",
        passed: missingFields.length === 0,
        message: missingFields.length === 0 
          ? "IDL structure is valid"
          : `IDL missing required fields: ${missingFields.join(", ")}`,
        severity: missingFields.length === 0 ? "info" : "error",
        details: { idlVersion: idl.version, programName: idl.name },
      });
      
      // Check if program can be loaded with IDL
      try {
        const programId = new PublicKey(config.programId);
        const program = new Program(idl, programId, this.provider);
        
        result.checks.push({
          name: "Program Loading",
          passed: true,
          message: `Program loaded successfully with ${Object.keys(program.methods).length} methods`,
          severity: "info",
          details: { 
            methodCount: Object.keys(program.methods).length,
            methods: Object.keys(program.methods),
          },
        });
        
        // Store version if available
        if (idl.version) {
          result.metadata.version = idl.version;
        }
        
      } catch (error) {
        result.checks.push({
          name: "Program Loading",
          passed: false,
          message: `Failed to load program with IDL: ${error}`,
          severity: "error",
        });
      }
      
      console.log(chalk.green("✅ IDL validation completed"));
      
    } catch (error) {
      result.checks.push({
        name: "IDL Parsing",
        passed: false,
        message: `Failed to parse IDL: ${error}`,
        severity: "error",
      });
    }
  }

  private async verifyProgramUpgrade(
    programId: PublicKey,
    result: VerificationResult
  ): Promise<void> {
    console.log(chalk.blue("🔍 Verifying program upgrade configuration..."));
    
    try {
      // Check if this is an upgradeable program
      const programDataAddress = PublicKey.findProgramAddressSync(
        [programId.toBuffer()],
        new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
      )[0];
      
      const programDataAccount = await this.retryOperation(async () => {
        return await this.connection.getAccountInfo(programDataAddress);
      }, "Failed to fetch program data account");
      
      if (programDataAccount) {
        result.metadata.programDataAccount = programDataAddress.toBase58();
        
        // Parse upgrade authority (first 45 bytes are metadata, next 32 bytes are authority)
        if (programDataAccount.data.length >= 45) {
          const authorityBytes = programDataAccount.data.slice(13, 45);
          const hasAuthority = !authorityBytes.every(byte => byte === 0);
          
          if (hasAuthority) {
            const authority = new PublicKey(authorityBytes);
            result.metadata.upgradeAuthority = authority.toBase58();
            
            result.checks.push({
              name: "Upgrade Authority",
              passed: true,
              message: `Program has upgrade authority: ${authority.toBase58()}`,
              severity: "info",
              details: { upgradeAuthority: authority.toBase58() },
            });
          } else {
            result.checks.push({
              name: "Upgrade Authority",
              passed: true,
              message: "Program upgrade authority is disabled (immutable)",
              severity: "info",
            });
          }
        }
        
        result.checks.push({
          name: "Program Upgradeability",
          passed: true,
          message: "Program is upgradeable",
          severity: "info",
        });
        
      } else {
        result.checks.push({
          name: "Program Upgradeability",
          passed: true,
          message: "Program is not upgradeable (legacy BPF program)",
          severity: "info",
        });
      }
      
      console.log(chalk.green("✅ Program upgrade verification completed"));
      
    } catch (error) {
      result.checks.push({
        name: "Upgrade Verification",
        passed: false,
        message: `Failed to verify upgrade configuration: ${error}`,
        severity: "warning",
      });
    }
  }

  private async verifyOnExplorer(
    programId: PublicKey,
    result: VerificationResult
  ): Promise<void> {
    console.log(chalk.blue("🔍 Verifying on Solana explorer..."));
    
    try {
      const explorerData = await this.fetchExplorerData(programId);
      
      result.checks.push({
        name: "Explorer Visibility",
        passed: explorerData.exists,
        message: explorerData.exists 
          ? "Program is visible on explorer"
          : "Program not found on explorer",
        severity: explorerData.exists ? "info" : "warning",
        details: explorerData,
      });
      
      if (explorerData.exists && explorerData.verified) {
        result.checks.push({
          name: "Explorer Verification",
          passed: true,
          message: "Program is verified on explorer",
          severity: "info",
        });
      }
      
      console.log(chalk.green("✅ Explorer verification completed"));
      
    } catch (error) {
      result.checks.push({
        name: "Explorer Verification",
        passed: false,
        message: `Explorer verification failed: ${error}`,
        severity: "warning",
      });
    }
  }

  private async fetchExplorerData(programId: PublicKey): Promise<ExplorerData> {
    const explorerApiUrl = this.getExplorerApiUrl();
    
    try {
      const response = await this.retryOperation(async () => {
        return await axios.get(`${explorerApiUrl}/account/${programId.toBase58()}`, {
          timeout: 10000,
        });
      }, "Failed to fetch explorer data");
      
      return {
        exists: response.status === 200,
        verified: response.data?.verified || false,
        metadata: response.data,
      };
      
    } catch (error) {
      if (error.response?.status === 404) {
        return { exists: false, verified: false };
      }
      
      return {
        exists: false,
        verified: false,
        error: error.toString(),
      };
    }
  }

  private getExplorerApiUrl(): string {
    switch (this.config.network) {
      case "devnet":
        return "https://api.devnet.solscan.io/v2";
      case "mainnet-beta":
        return "https://api.solscan.io/v2";
      case "localnet":
        return "http://localhost:3000/api"; // Assume local explorer
      default:
        return "https://api.solscan.io/v2";
    }
  }

  private async runCustomValidation(
    config: ProgramVerificationConfig,
    result: VerificationResult
  ): Promise<void> {
    console.log(chalk.blue("🔍 Running custom validation rules..."));
    
    try {
      const programId = new PublicKey(config.programId);
      const accountInfo = await this.connection.getAccountInfo(programId);
      
      if (!accountInfo) {
        throw new Error("Program account not found");
      }
      
      const idl = JSON.parse(fs.readFileSync(config.idlPath, "utf8"));
      const program = new Program(idl, programId, this.provider);
      
      for (const rule of config.customValidation!) {
        try {
          const passed = await rule.check(program, accountInfo);
          
          result.checks.push({
            name: rule.name,
            passed,
            message: rule.description,
            severity: rule.severity,
          });
          
        } catch (error) {
          result.checks.push({
            name: rule.name,
            passed: false,
            message: `Custom validation failed: ${error}`,
            severity: "error",
          });
        }
      }
      
      console.log(chalk.green("✅ Custom validation completed"));
      
    } catch (error) {
      result.checks.push({
        name: "Custom Validation",
        passed: false,
        message: `Custom validation error: ${error}`,
        severity: "error",
      });
    }
  }

  private async runSecurityAudit(
    config: ProgramVerificationConfig,
    result: VerificationResult
  ): Promise<void> {
    console.log(chalk.blue("🔍 Running security audit..."));
    
    try {
      const programId = new PublicKey(config.programId);
      const accountInfo = await this.connection.getAccountInfo(programId);
      
      if (!accountInfo) {
        throw new Error("Program account not found for security audit");
      }
      
      const idl = JSON.parse(fs.readFileSync(config.idlPath, "utf8"));
      
      for (const rule of this.config.auditRules) {
        try {
          const issues = await rule.check(accountInfo.data, idl);
          result.securityIssues.push(...issues);
          
        } catch (error) {
          result.securityIssues.push({
            severity: "medium",
            type: "audit_error",
            description: `Security audit rule '${rule.name}' failed: ${error}`,
            recommendation: "Review audit rule implementation",
          });
        }
      }
      
      // Add summary check
      const criticalIssues = result.securityIssues.filter(i => i.severity === "critical").length;
      const highIssues = result.securityIssues.filter(i => i.severity === "high").length;
      
      result.checks.push({
        name: "Security Audit",
        passed: criticalIssues === 0,
        message: `Found ${criticalIssues} critical, ${highIssues} high severity issues`,
        severity: criticalIssues > 0 ? "error" : highIssues > 0 ? "warning" : "info",
        details: {
          criticalIssues,
          highIssues,
          totalIssues: result.securityIssues.length,
        },
      });
      
      console.log(chalk.green("✅ Security audit completed"));
      
    } catch (error) {
      result.checks.push({
        name: "Security Audit",
        passed: false,
        message: `Security audit failed: ${error}`,
        severity: "warning",
      });
    }
  }

  private async verifySourceCode(
    config: ProgramVerificationConfig,
    result: VerificationResult
  ): Promise<void> {
    console.log(chalk.blue("🔍 Verifying source code..."));
    
    try {
      if (!fs.existsSync(config.sourceCodePath!)) {
        result.checks.push({
          name: "Source Code Verification",
          passed: false,
          message: `Source code path not found: ${config.sourceCodePath}`,
          severity: "warning",
        });
        return;
      }
      
      // Calculate source code hash
      const sourceFiles = this.getAllSourceFiles(config.sourceCodePath!);
      const sourceHash = this.calculateSourceHash(sourceFiles);
      
      result.checks.push({
        name: "Source Code Hash",
        passed: true,
        message: `Source code hash: ${sourceHash}`,
        severity: "info",
        details: {
          sourceHash,
          fileCount: sourceFiles.length,
        },
      });
      
      console.log(chalk.green("✅ Source code verification completed"));
      
    } catch (error) {
      result.checks.push({
        name: "Source Code Verification",
        passed: false,
        message: `Source code verification failed: ${error}`,
        severity: "warning",
      });
    }
  }

  private getAllSourceFiles(sourcePath: string): string[] {
    const files: string[] = [];
    
    const traverse = (dir: string) => {
      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory() && !item.startsWith('.')) {
          traverse(fullPath);
        } else if (item.endsWith('.rs') || item.endsWith('.toml')) {
          files.push(fullPath);
        }
      }
    };
    
    traverse(sourcePath);
    return files.sort();
  }

  private calculateSourceHash(files: string[]): string {
    const hash = crypto.createHash('sha256');
    
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      hash.update(content);
    }
    
    return hash.digest('hex');
  }

  private async retryOperation<T>(
    operation: () => Promise<T>,
    errorMessage: string
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        if (attempt < this.config.retryAttempts) {
          console.log(chalk.yellow(`⚠️  Attempt ${attempt} failed, retrying in ${this.config.retryDelay}ms...`));
          await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
        }
      }
    }
    
    throw new Error(`${errorMessage}: ${lastError}`);
  }

  private async generateVerificationReport(): Promise<void> {
    console.log(chalk.blue("\n📋 Generating verification report..."));
    
    const reportData = {
      timestamp: new Date().toISOString(),
      network: this.config.network,
      summary: this.generateSummary(),
      results: Object.fromEntries(
        Array.from(this.verificationResults.entries()).map(([id, result]) => [
          id,
          {
            ...result,
            checks: result.checks.map(check => ({
              ...check,
              details: undefined, // Remove details for summary
            })),
          },
        ])
      ),
    };
    
    // Save detailed report
    const reportsDir = path.join(process.cwd(), "verification-reports");
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    
    const reportFile = path.join(
      reportsDir,
      `verification-${this.config.network}-${Date.now()}.json`
    );
    
    fs.writeFileSync(reportFile, JSON.stringify(reportData, null, 2));
    
    // Display summary
    this.displayVerificationSummary();
    
    console.log(chalk.gray(`\nDetailed report saved to: ${reportFile}`));
  }

  private generateSummary() {
    const total = this.verificationResults.size;
    const successful = Array.from(this.verificationResults.values())
      .filter(r => r.success).length;
    const failed = total - successful;
    
    const totalChecks = Array.from(this.verificationResults.values())
      .reduce((sum, r) => sum + r.checks.length, 0);
    const passedChecks = Array.from(this.verificationResults.values())
      .reduce((sum, r) => sum + r.checks.filter(c => c.passed).length, 0);
    
    const totalSecurityIssues = Array.from(this.verificationResults.values())
      .reduce((sum, r) => sum + r.securityIssues.length, 0);
    const criticalIssues = Array.from(this.verificationResults.values())
      .reduce((sum, r) => sum + r.securityIssues.filter(i => i.severity === "critical").length, 0);
    
    return {
      totalPrograms: total,
      successfulVerifications: successful,
      failedVerifications: failed,
      totalChecks,
      passedChecks,
      totalSecurityIssues,
      criticalSecurityIssues: criticalIssues,
    };
  }

  private displayVerificationSummary(): void {
    const summary = this.generateSummary();
    
    console.log(chalk.blue("\n📊 Verification Summary"));
    console.log("━".repeat(50));
    
    console.log(`Programs Verified: ${summary.totalPrograms}`);
    console.log(chalk.green(`✅ Successful: ${summary.successfulVerifications}`));
    console.log(chalk.red(`❌ Failed: ${summary.failedVerifications}`));
    
    console.log(`\nChecks: ${summary.passedChecks}/${summary.totalChecks} passed`);
    
    if (summary.totalSecurityIssues > 0) {
      console.log(`\n🔒 Security Issues: ${summary.totalSecurityIssues}`);
      if (summary.criticalSecurityIssues > 0) {
        console.log(chalk.red(`  Critical: ${summary.criticalSecurityIssues}`));
      }
    }
    
    // Display individual program results
    console.log(chalk.blue("\n📋 Program Results:"));
    for (const [programId, result] of this.verificationResults) {
      const status = result.success ? chalk.green("✅") : chalk.red("❌");
      const issues = result.securityIssues.length > 0 
        ? chalk.yellow(` (${result.securityIssues.length} security issues)`)
        : "";
      
      console.log(`${status} ${result.programName} (${programId.slice(0, 8)}...)${issues}`);
    }
  }
}

// Default security rules
const DEFAULT_SECURITY_RULES: SecurityRule[] = [
  {
    name: "Authority Validation",
    description: "Check for proper authority validation in instructions",
    check: async (programData: Buffer, idl: any): Promise<SecurityIssue[]> => {
      const issues: SecurityIssue[] = [];
      
      // Look for instructions without proper authority checks
      for (const instruction of idl.instructions || []) {
        const hasAuthority = instruction.accounts?.some((account: any) => 
          account.name.toLowerCase().includes('authority') || 
          account.name.toLowerCase().includes('signer')
        );
        
        if (!hasAuthority) {
          issues.push({
            severity: "medium",
            type: "missing_authority",
            description: `Instruction '${instruction.name}' may lack proper authority validation`,
            location: `instruction.${instruction.name}`,
            recommendation: "Ensure proper authority/signer validation in instruction accounts",
          });
        }
      }
      
      return issues;
    },
  },
  {
    name: "Account Validation",
    description: "Check for proper account validation patterns",
    check: async (programData: Buffer, idl: any): Promise<SecurityIssue[]> => {
      const issues: SecurityIssue[] = [];
      
      // Check for potential account confusion attacks
      for (const instruction of idl.instructions || []) {
        const accountNames = instruction.accounts?.map((acc: any) => acc.name.toLowerCase()) || [];
        
        // Look for similar account names that could be confused
        for (let i = 0; i < accountNames.length; i++) {
          for (let j = i + 1; j < accountNames.length; j++) {
            const similarity = calculateSimilarity(accountNames[i], accountNames[j]);
            if (similarity > 0.8) {
              issues.push({
                severity: "low",
                type: "account_confusion",
                description: `Similar account names in '${instruction.name}': '${accountNames[i]}' and '${accountNames[j]}'`,
                location: `instruction.${instruction.name}`,
                recommendation: "Use clearly distinct account names to prevent confusion",
              });
            }
          }
        }
      }
      
      return issues;
    },
  },
  {
    name: "PDA Validation",
    description: "Check for proper PDA validation",
    check: async (programData: Buffer, idl: any): Promise<SecurityIssue[]> => {
      const issues: SecurityIssue[] = [];
      
 // Look for instructions that might use PDAs without proper validation
      for (const instruction of idl.instructions || []) {
        const hasPdaAccounts = instruction.accounts?.some((account: any) => 
          account.name.toLowerCase().includes('pda') || 
          account.name.toLowerCase().includes('program_derived')
        );
        
        if (hasPdaAccounts) {
          // Check if there are proper seeds or validation
          const hasSeeds = instruction.args?.some((arg: any) => 
            arg.name.toLowerCase().includes('seed') || 
            arg.name.toLowerCase().includes('bump')
          );
          
          if (!hasSeeds) {
            issues.push({
              severity: "high",
              type: "pda_validation",
              description: `Instruction '${instruction.name}' uses PDAs but may lack proper seed validation`,
              location: `instruction.${instruction.name}`,
              recommendation: "Ensure PDAs are properly validated with seeds and bump parameters",
            });
          }
        }
      }
      
      return issues;
    },
  },
  {
    name: "Overflow Protection",
    description: "Check for potential arithmetic overflow issues",
    check: async (programData: Buffer, idl: any): Promise<SecurityIssue[]> => {
      const issues: SecurityIssue[] = [];
      
      // Check for instructions that handle numeric operations
      for (const instruction of idl.instructions || []) {
        const hasNumericArgs = instruction.args?.some((arg: any) => 
          arg.type === 'u64' || arg.type === 'u128' || arg.type === 'i64' || 
          arg.name.toLowerCase().includes('amount') || 
          arg.name.toLowerCase().includes('value')
        );
        
        if (hasNumericArgs) {
          issues.push({
            severity: "medium",
            type: "arithmetic_overflow",
            description: `Instruction '${instruction.name}' handles numeric values - ensure overflow protection`,
            location: `instruction.${instruction.name}`,
            recommendation: "Use checked arithmetic operations and validate input ranges",
          });
        }
      }
      
      return issues;
    },
  },
];

// Utility functions for similarity calculation
function calculateSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(str1: string, str2: string): number {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

// Environment-specific configurations
const VERIFICATION_CONFIGS: Record<string, Partial<VerificationConfig>> = {
  devnet: {
    network: "devnet",
    rpcUrl: "https://api.devnet.solana.com",
    explorerUrl: "https://explorer.solana.com",
    retryAttempts: 3,
    retryDelay: 2000,
    commitment: "confirmed",
    enableSecurityAudit: true,
    auditRules: DEFAULT_SECURITY_RULES,
  },
  mainnet: {
    network: "mainnet-beta",
    rpcUrl: "https://api.mainnet-beta.solana.com",
    explorerUrl: "https://explorer.solana.com",
    retryAttempts: 5,
    retryDelay: 3000,
    commitment: "finalized",
    enableSecurityAudit: true,
    auditRules: DEFAULT_SECURITY_RULES,
  },
  localnet: {
    network: "localnet",
    rpcUrl: "http://localhost:8899",
    explorerUrl: "http://localhost:3000",
    retryAttempts: 2,
    retryDelay: 1000,
    commitment: "confirmed",
    enableSecurityAudit: false,
    auditRules: [],
  },
};

// Custom validation rules examples
const EXAMPLE_VALIDATION_RULES: ValidationRule[] = [
  {
    name: "Program Size Check",
    description: "Verify program size is within reasonable limits",
    severity: "warning",
    check: async (program: Program, accountInfo: AccountInfo<Buffer>): Promise<boolean> => {
      const maxSize = 1024 * 1024; // 1MB
      return accountInfo.data.length <= maxSize;
    },
  },
  {
    name: "Method Count Check",
    description: "Verify program has expected number of methods",
    severity: "info",
    check: async (program: Program, accountInfo: AccountInfo<Buffer>): Promise<boolean> => {
      const methodCount = Object.keys(program.methods).length;
      return methodCount > 0 && methodCount <= 50; // Reasonable range
    },
  },
  {
    name: "Rent Exemption Check",
    description: "Verify program account is rent exempt",
    severity: "warning",
    check: async (program: Program, accountInfo: AccountInfo<Buffer>): Promise<boolean> => {
      // If rentEpoch is null or very high, account is rent exempt
      return accountInfo.rentEpoch === null || accountInfo.rentEpoch > 1000;
    },
  },
];

// Batch verification function
export async function batchVerifyPrograms(
  environment: "devnet" | "mainnet" | "localnet" = "devnet",
  programs: ProgramVerificationConfig[],
  customConfig?: Partial<VerificationConfig>
): Promise<Map<string, VerificationResult>> {
  try {
    // Load base configuration
    const baseConfig = VERIFICATION_CONFIGS[environment];
    if (!baseConfig) {
      throw new Error(`Unknown environment: ${environment}`);
    }
    
    // Merge configurations
    const config: VerificationConfig = {
      ...baseConfig,
      programs,
      ...customConfig,
    } as VerificationConfig;
    
    // Create verifier and run verification
    const verifier = new ProgramVerifier(config);
    return await verifier.verifyPrograms();
    
  } catch (error) {
    console.error(chalk.red("Batch verification error:"), error);
    throw error;
  }
}

// Single program verification function
export async function verifyProgram(
  programId: string,
  programName: string,
  idlPath: string,
  environment: "devnet" | "mainnet" | "localnet" = "devnet",
  options?: {
    sourceCodePath?: string;
    expectedVersion?: string;
    skipExplorerVerification?: boolean;
    customValidation?: ValidationRule[];
  }
): Promise<VerificationResult> {
  const programConfig: ProgramVerificationConfig = {
    name: programName,
    programId,
    idlPath,
    ...options,
  };
  
  const results = await batchVerifyPrograms(environment, [programConfig]);
  const result = results.get(programId);
  
  if (!result) {
    throw new Error(`Verification result not found for program ${programId}`);
  }
  
  return result;
}

// Load programs from deployment artifacts
export function loadProgramsFromDeployment(
  deploymentFile: string,
  idlDirectory: string = "./target/idl"
): ProgramVerificationConfig[] {
  try {
    const deploymentData = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
    const programs: ProgramVerificationConfig[] = [];
    
    for (const [programName, programInfo] of Object.entries(deploymentData.programs || {})) {
      const programData = programInfo as any;
      
      if (programData.success && programData.programId) {
        const idlPath = path.join(idlDirectory, `${programName}.json`);
        
        programs.push({
          name: programName,
          programId: programData.programId,
          idlPath,
          customValidation: EXAMPLE_VALIDATION_RULES,
        });
      }
    }
    
    return programs;
    
  } catch (error) {
    throw new Error(`Failed to load programs from deployment file: ${error}`);
  }
}

// Explorer verification utilities
export class ExplorerVerifier {
  private config: VerificationConfig;
  
  constructor(config: VerificationConfig) {
    this.config = config;
  }
  
  async verifyProgramOnSolscan(programId: string): Promise<boolean> {
    try {
      const response = await axios.get(
        `https://api.solscan.io/account?address=${programId}`,
        { timeout: 10000 }
      );
      
      return response.status === 200 && response.data?.success;
    } catch (error) {
      console.warn(`Solscan verification failed for ${programId}:`, error);
      return false;
    }
  }
  
  async verifyProgramOnSolanaFM(programId: string): Promise<boolean> {
    try {
      const response = await axios.get(
        `https://api.solana.fm/v0/accounts/${programId}`,
        { timeout: 10000 }
      );
      
      return response.status === 200;
    } catch (error) {
      console.warn(`SolanaFM verification failed for ${programId}:`, error);
      return false;
    }
  }
}

// Main verification CLI function
export async function main(): Promise<void> {
  const environment = (process.env.ANCHOR_ENV as any) || "devnet";
  const deploymentFile = process.env.DEPLOYMENT_FILE || `./deployments/${environment}-current.json`;
  
  try {
    console.log(chalk.blue("🔍 Starting program verification..."));
    console.log(chalk.gray(`Environment: ${environment}`));
    console.log(chalk.gray(`Deployment file: ${deploymentFile}`));
    
    // Load programs from deployment
    const programs = loadProgramsFromDeployment(deploymentFile);
    
    if (programs.length === 0) {
      console.log(chalk.yellow("⚠️  No programs found to verify"));
      return;
    }
    
    console.log(chalk.blue(`Found ${programs.length} programs to verify`));
    
    // Run batch verification
    const results = await batchVerifyPrograms(environment, programs, {
      enableSecurityAudit: environment !== "localnet",
    });
    
    // Check for failures
    const failures = Array.from(results.values()).filter(r => !r.success);
    if (failures.length > 0) {
      console.error(chalk.red(`\n❌ ${failures.length} programs failed verification`));
      process.exit(1);
    }
    
    console.log(chalk.green("\n✅ All programs verified successfully!"));
    
  } catch (error) {
    console.error(chalk.red("Verification failed:"), error);
    process.exit(1);
  }
}

// Export verification classes and utilities
export {
  ProgramVerifier,
  ExplorerVerifier,
  DEFAULT_SECURITY_RULES,
  EXAMPLE_VALIDATION_RULES,
  VERIFICATION_CONFIGS,
};

// Export types
export type {
  VerificationConfig,
  ProgramVerificationConfig,
  ValidationRule,
  SecurityRule,
  SecurityIssue,
  VerificationResult,
  CheckResult,
  ProgramMetadata,
  ExplorerData,
};

// Run main function if script is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
