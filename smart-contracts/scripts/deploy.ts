import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  TransactionSignature
} from "@solana/web3.js";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import chalk from "chalk";

// Environment configuration
interface DeploymentConfig {
  network: "devnet" | "mainnet-beta" | "localnet";
  rpcUrl: string;
  programs: ProgramConfig[];
  admin: PublicKey;
  estimatedCostSOL: number;
  confirmations: number;
}

interface ProgramConfig {
  name: string;
  idlPath: string;
  programPath: string;
  dependencies: string[];
  initializeParams?: any;
  skipVerification?: boolean;
}

interface DeploymentResult {
  programId: PublicKey;
  signature: string;
  slot: number;
  success: boolean;
  error?: string;
}

class AnchorDeployer {
  private provider: AnchorProvider;
  private connection: Connection;
  private wallet: Wallet;
  private config: DeploymentConfig;
  private deployedPrograms: Map<string, DeploymentResult> = new Map();
  private programIds: Map<string, PublicKey> = new Map();

  constructor(config: DeploymentConfig, wallet: Wallet) {
    this.config = config;
    this.wallet = wallet;
    this.connection = new Connection(config.rpcUrl, {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: 60000,
    });
    this.provider = new AnchorProvider(this.connection, wallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
    anchor.setProvider(this.provider);
  }

  async deploy(): Promise<boolean> {
    console.log(chalk.blue("🚀 Starting Anchor deployment process..."));
    console.log(chalk.gray(`Network: ${this.config.network}`));
    console.log(chalk.gray(`RPC: ${this.config.rpcUrl}`));
    
    try {
      // Pre-deployment checks
      await this.preDeploymentChecks();
      
      // Build programs
      await this.buildPrograms();
      
      // Deploy programs in dependency order
      const deploymentOrder = this.resolveDependencyOrder();
      console.log(chalk.blue("📋 Deployment order:"), deploymentOrder.join(" → "));
      
      for (const programName of deploymentOrder) {
        await this.deployProgram(programName);
      }
      
      // Post-deployment verification
      await this.verifyDeployments();
      
      // Save deployment artifacts
      await this.saveDeploymentArtifacts();
      
      console.log(chalk.green("✅ Deployment completed successfully!"));
      return true;
      
    } catch (error) {
      console.error(chalk.red("❌ Deployment failed:"), error);
      await this.handleRollback();
      return false;
    }
  }

  private async preDeploymentChecks(): Promise<void> {
    console.log(chalk.blue("🔍 Running pre-deployment checks..."));
    
    // Check wallet balance
    const balance = await this.connection.getBalance(this.wallet.publicKey);
    const balanceSOL = balance / LAMPORTS_PER_SOL;
    
    console.log(chalk.gray(`Wallet: ${this.wallet.publicKey.toBase58()}`));
    console.log(chalk.gray(`Balance: ${balanceSOL.toFixed(4)} SOL`));
    
    if (balanceSOL < this.config.estimatedCostSOL) {
      throw new Error(
        `Insufficient balance. Required: ${this.config.estimatedCostSOL} SOL, Available: ${balanceSOL} SOL`
      );
    }
    
    // Check program files exist
    for (const program of this.config.programs) {
      if (!fs.existsSync(program.programPath)) {
        throw new Error(`Program binary not found: ${program.programPath}`);
      }
      if (!fs.existsSync(program.idlPath)) {
        throw new Error(`IDL file not found: ${program.idlPath}`);
      }
    }
    
    // Check network connectivity
    const slot = await this.connection.getSlot();
    console.log(chalk.gray(`Current slot: ${slot}`));
    
    console.log(chalk.green("✅ Pre-deployment checks passed"));
  }

  private async buildPrograms(): Promise<void> {
    console.log(chalk.blue("🔨 Building programs..."));
    
    try {
      // Build all programs using Anchor CLI
      execSync("anchor build", { 
        stdio: "inherit",
        cwd: process.cwd()
      });
      
      console.log(chalk.green("✅ Programs built successfully"));
    } catch (error) {
      throw new Error(`Build failed: ${error}`);
    }
  }

  private resolveDependencyOrder(): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const order: string[] = [];
    
    const visit = (programName: string) => {
      if (visiting.has(programName)) {
        throw new Error(`Circular dependency detected involving ${programName}`);
      }
      if (visited.has(programName)) return;
      
      visiting.add(programName);
      
      const program = this.config.programs.find(p => p.name === programName);
      if (!program) {
        throw new Error(`Program not found: ${programName}`);
      }
      
      // Visit dependencies first
      for (const dep of program.dependencies) {
        visit(dep);
      }
      
      visiting.delete(programName);
      visited.add(programName);
      order.push(programName);
    };
    
    for (const program of this.config.programs) {
      visit(program.name);
    }
    
    return order;
  }

  private async deployProgram(programName: string): Promise<void> {
    console.log(chalk.blue(`📦 Deploying ${programName}...`));
    
    const programConfig = this.config.programs.find(p => p.name === programName);
    if (!programConfig) {
      throw new Error(`Program config not found: ${programName}`);
    }
    
    try {
      // Generate program keypair if not exists
      const programKeypair = this.loadOrCreateProgramKeypair(programName);
      const programId = programKeypair.publicKey;
      
      console.log(chalk.gray(`Program ID: ${programId.toBase58()}`));
      
      // Deploy using Anchor CLI with specific program ID
      const deployCommand = `anchor deploy --program-name ${programName} --program-keypair ${this.getProgramKeypairPath(programName)}`;
      
      if (this.config.network !== "localnet") {
        execSync(`${deployCommand} --provider.cluster ${this.config.network}`, {
          stdio: "inherit",
          cwd: process.cwd()
        });
      } else {
        execSync(deployCommand, {
          stdio: "inherit",
          cwd: process.cwd()
        });
      }
      
      // Verify deployment
      await this.verifyProgramDeployment(programId);
      
      // Initialize program if needed
      if (programConfig.initializeParams) {
        await this.initializeProgram(programName, programId, programConfig.initializeParams);
      }
      
      // Store deployment result
      const deploymentResult: DeploymentResult = {
        programId,
        signature: "deployment", // Anchor CLI handles this
        slot: await this.connection.getSlot(),
        success: true
      };
      
      this.deployedPrograms.set(programName, deploymentResult);
      this.programIds.set(programName, programId);
      
      console.log(chalk.green(`✅ ${programName} deployed successfully`));
      
    } catch (error) {
      const deploymentResult: DeploymentResult = {
        programId: PublicKey.default,
        signature: "",
        slot: 0,
        success: false,
        error: error.toString()
      };
      
      this.deployedPrograms.set(programName, deploymentResult);
      throw new Error(`Failed to deploy ${programName}: ${error}`);
    }
  }

  private loadOrCreateProgramKeypair(programName: string): Keypair {
    const keypairPath = this.getProgramKeypairPath(programName);
    
    if (fs.existsSync(keypairPath)) {
      const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
      return Keypair.fromSecretKey(new Uint8Array(keypairData));
    } else {
      // Generate new keypair
      const keypair = Keypair.generate();
      
      // Ensure directory exists
      const dir = path.dirname(keypairPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Save keypair
      fs.writeFileSync(
        keypairPath,
        JSON.stringify(Array.from(keypair.secretKey)),
        "utf8"
      );
      
      console.log(chalk.yellow(`Generated new keypair for ${programName}`));
      return keypair;
    }
  }

  private getProgramKeypairPath(programName: string): string {
    return path.join(process.cwd(), "target", "deploy", `${programName}-keypair.json`);
  }

  private async verifyProgramDeployment(programId: PublicKey): Promise<void> {
    console.log(chalk.blue("🔍 Verifying program deployment..."));
    
    const accountInfo = await this.connection.getAccountInfo(programId);
    if (!accountInfo) {
      throw new Error("Program account not found after deployment");
    }
    
    if (!accountInfo.executable) {
      throw new Error("Deployed account is not executable");
    }
    
    console.log(chalk.green("✅ Program deployment verified"));
  }

  private async initializeProgram(
    programName: string,
    programId: PublicKey,
    initParams: any
  ): Promise<void> {
    console.log(chalk.blue(`🔧 Initializing ${programName}...`));
    
    try {
      // Load program IDL
      const idlPath = this.config.programs.find(p => p.name === programName)?.idlPath;
      if (!idlPath) {
        throw new Error(`IDL path not found for ${programName}`);
      }
      
      const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
      const program = new Program(idl, programId, this.provider);
      
      // Create initialization transaction
      const tx = new Transaction();
      
      // Add initialization instruction based on program requirements
      // This is program-specific and would need to be customized
      const initializeIx = await program.methods
        .initialize(initParams)
        .accounts({
          admin: this.config.admin,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      
      tx.add(initializeIx);
      
      // Send and confirm transaction
      const signature = await sendAndConfirmTransaction(
        this.connection,
        tx,
        [this.wallet.payer], // Assuming wallet has payer
        {
          commitment: "confirmed",
          skipPreflight: false,
        }
      );
      
      console.log(chalk.green(`✅ ${programName} initialized. Signature: ${signature}`));
      
    } catch (error) {
      console.warn(chalk.yellow(`⚠️  Program initialization failed: ${error}`));
      // Don't throw - initialization might not be required for all programs
    }
  }

  private async verifyDeployments(): Promise<void> {
    console.log(chalk.blue("🔍 Running post-deployment verification..."));
    
    for (const [programName, result] of this.deployedPrograms) {
      if (!result.success) continue;
      
      const programConfig = this.config.programs.find(p => p.name === programName);
      if (programConfig?.skipVerification) {
        console.log(chalk.yellow(`⏭️  Skipping verification for ${programName}`));
        continue;
      }
      
      try {
        // Verify program is executable and has correct owner
        const accountInfo = await this.connection.getAccountInfo(result.programId);
        
        if (!accountInfo?.executable) {
          throw new Error(`${programName} is not executable`);
        }
        
        // Run basic program test if available
        await this.runProgramTest(programName, result.programId);
        
        console.log(chalk.green(`✅ ${programName} verification passed`));
        
      } catch (error) {
        console.error(chalk.red(`❌ ${programName} verification failed:`, error));
        throw error;
      }
    }
  }

  private async runProgramTest(programName: string, programId: PublicKey): Promise<void> {
    // Basic smoke test - try to load the program
    try {
      const idlPath = this.config.programs.find(p => p.name === programName)?.idlPath;
      if (!idlPath) return;
      
      const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
      const program = new Program(idl, programId, this.provider);
      
      // Verify program methods are accessible
      if (Object.keys(program.methods).length === 0) {
        throw new Error("No methods found in program");
      }
      
      console.log(chalk.gray(`Program ${programName} has ${Object.keys(program.methods).length} methods`));
      
    } catch (error) {
      throw new Error(`Program test failed: ${error}`);
    }
  }

  private async saveDeploymentArtifacts(): Promise<void> {
    console.log(chalk.blue("💾 Saving deployment artifacts..."));
    
    const deploymentInfo = {
      network: this.config.network,
      timestamp: new Date().toISOString(),
      deployer: this.wallet.publicKey.toBase58(),
      programs: Object.fromEntries(
        Array.from(this.deployedPrograms.entries()).map(([name, result]) => [
          name,
          {
            programId: result.programId.toBase58(),
            success: result.success,
            error: result.error,
            slot: result.slot,
          }
        ])
      ),
    };
    
    // Save to deployment history
    const deploymentsDir = path.join(process.cwd(), "deployments");
    if (!fs.existsSync(deploymentsDir)) {
      fs.mkdirSync(deploymentsDir, { recursive: true });
    }
    
    const deploymentFile = path.join(
      deploymentsDir,
      `${this.config.network}-${Date.now()}.json`
    );
    
    fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
    
    // Update current deployment
    const currentFile = path.join(deploymentsDir, `${this.config.network}-current.json`);
    fs.writeFileSync(currentFile, JSON.stringify(deploymentInfo, null, 2));
    
    // Log program IDs for easy access
    console.log(chalk.blue("\n📋 Deployed Program IDs:"));
    for (const [name, result] of this.deployedPrograms) {
      if (result.success) {
        console.log(chalk.green(`${name}: ${result.programId.toBase58()}`));
      }
    }
    
    console.log(chalk.gray(`\nDeployment info saved to: ${deploymentFile}`));
  }

  private async handleRollback(): Promise<void> {
    console.log(chalk.yellow("🔄 Initiating rollback procedures..."));
    
    // Log failed deployments
    const failedDeployments = Array.from(this.deployedPrograms.entries())
      .filter(([_, result]) => !result.success);
    
    if (failedDeployments.length > 0) {
      console.log(chalk.red("❌ Failed deployments:"));
      for (const [name, result] of failedDeployments) {
        console.log(chalk.red(`  ${name}: ${result.error}`));
      }
    }
    
    // Save rollback info
    const rollbackInfo = {
      timestamp: new Date().toISOString(),
      network: this.config.network,
      failedDeployments: Object.fromEntries(failedDeployments),
      successfulDeployments: Object.fromEntries(
        Array.from(this.deployedPrograms.entries())
          .filter(([_, result]) => result.success)
      ),
    };
    
    const rollbackFile = path.join(
      process.cwd(),
      "deployments",
      `rollback-${this.config.network}-${Date.now()}.json`
    );
    
    fs.writeFileSync(rollbackFile, JSON.stringify(rollbackInfo, null, 2));
    
    console.log(chalk.yellow(`Rollback info saved to: ${rollbackFile}`));
    console.log(chalk.yellow("Manual cleanup may be required for successful deployments"));
  }

  async estimateDeploymentCost(): Promise<number> {
    // Rough estimation based on program sizes and current rent
    const rentExemptBalance = await this.connection.getMinimumBalanceForRentExemption(0);
    let totalCost = 0;
    
    for (const program of this.config.programs) {
      if (fs.existsSync(program.programPath)) {
        const stats = fs.statSync(program.programPath);
        const programSize = stats.size;
        
        // Estimate cost: rent + deployment fee
        const programRent = await this.connection.getMinimumBalanceForRentExemption(programSize);
        totalCost += programRent;
      }
    }
    
    // Add buffer for transaction fees
    totalCost += 0.1 * LAMPORTS_PER_SOL; // 0.1 SOL buffer
    
    return totalCost / LAMPORTS_PER_SOL;
  }
}

// Environment-specific configurations
const DEPLOYMENT_CONFIGS: Record<string, Partial<DeploymentConfig>> = {
  devnet: {
    network: "devnet",
    rpcUrl: "https://api.devnet.solana.com",
    confirmations: 1,
    estimatedCostSOL: 2.0,
  },
  mainnet: {
    network: "mainnet-beta",
    rpcUrl: "https://api.mainnet-beta.solana.com",
    confirmations: 3,
    estimatedCostSOL: 5.0,
  },
  localnet: {
    network: "localnet",
    rpcUrl: "http://localhost:8899",
    confirmations: 1,
    estimatedCostSOL: 1.0,
  },
};

// Main deployment function
export async function deploy(
  environment: "devnet" | "mainnet" | "localnet" = "devnet",
  programs: ProgramConfig[],
  adminPublicKey: string,
  walletPath?: string
): Promise<boolean> {
  try {
    // Load wallet
    let wallet: Wallet;
    if (walletPath && fs.existsSync(walletPath)) {
      const keypairData = JSON.parse(fs.readFileSync(walletPath, "utf8"));
      const keypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
      wallet = new Wallet(keypair);
    } else {
      // Use default wallet or generate one
      const keypair = Keypair.generate();
      wallet = new Wallet(keypair);
      console.log(chalk.yellow("⚠️  Using generated wallet. Make sure it has sufficient SOL."));
      console.log(chalk.gray(`Wallet: ${keypair.publicKey.toBase58()}`));
    }
    
    // Create deployment config
    const baseConfig = DEPLOYMENT_CONFIGS[environment];
    if (!baseConfig) {
      throw new Error(`Unknown environment: ${environment}`);
    }
    
    const config: DeploymentConfig = {
      ...baseConfig,
      programs,
      admin: new PublicKey(adminPublicKey),
    } as DeploymentConfig;
    
    // Create deployer and run deployment
    const deployer = new AnchorDeployer(config, wallet);
    
    // Estimate cost
    const estimatedCost = await deployer.estimateDeploymentCost();
    console.log(chalk.blue(`Estimated deployment cost: ${estimatedCost.toFixed(4)} SOL`));
    
    return await deployer.deploy();
    
  } catch (error) {
    console.error(chalk.red("Deployment error:"), error);
    return false;
  }
}

// Example usage
if (require.main === module) {
  const programs: ProgramConfig[] = [
    {
      name: "my_program",
      idlPath: "./target/idl/my_program.json",
      programPath: "./target/deploy/my_program.so",
      dependencies: [],
      initializeParams: {
        admin: "YOUR_ADMIN_PUBKEY_HERE",
      },
    },
    // Add more programs as needed
  ];
  
  const adminKey = "YOUR_ADMIN_PUBKEY_HERE";
  const environment = (process.env.ANCHOR_ENV as any) || "devnet";
  const walletPath = process.env.ANCHOR_WALLET;
  
  deploy(environment, programs, adminKey, walletPath)
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
