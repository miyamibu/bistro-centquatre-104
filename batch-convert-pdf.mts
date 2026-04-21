import puppeteer from "puppeteer";
import * as path from "path";
import * as fs from "fs";
import { glob } from "glob";

interface ConversionResult {
  originalPath: string;
  outputPath: string;
  status: "success" | "failed";
  error?: string;
  timestamp: string;
}

async function batchConvertPDFs() {
  let browser;
  const results: ConversionResult[] = [];
  const startTime = new Date();

  try {
    const photosDir = path.join(
      process.cwd(),
      "public",
      "photos"
    );

    // Find all PDF files
    const pdfFiles = await glob(`${photosDir}/**/*.pdf`);
    console.log(`\n📁 Found ${pdfFiles.length} PDF file(s) to convert\n`);

    if (pdfFiles.length === 0) {
      console.log("No PDF files found.");
      return;
    }

    // Create output directory
    const outputDir = path.join(process.cwd(), "public", "converted-images");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Launch browser
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    // Process each PDF
    for (let i = 0; i < pdfFiles.length; i++) {
      const pdfFile = pdfFiles[i];
      const relativePath = path.relative(photosDir, pdfFile);

      console.log(`[${i + 1}/${pdfFiles.length}] Converting: ${relativePath}`);

      try {
        const page = await browser.newPage();

        // Generate filename
        const baseFileName = path.basename(pdfFile, ".pdf");
        const folderName = path.basename(path.dirname(pdfFile));
        const fileName = `${Date.now()}-${folderName}-${baseFileName}`;

        // Open PDF file - use absolute path with forward slashes
        const absolutePath = path.resolve(pdfFile).replace(/\\/g, "/");
        const fileUrl = `file:///${absolutePath}`;
        await page.goto(fileUrl, { waitUntil: "networkidle0" });

        // Set viewport
        await page.setViewport({ width: 1200, height: 1600 });

        // Take screenshot
        const imagePath = path.join(outputDir, `${fileName}.png`);
        await page.screenshot({
          path: imagePath,
          fullPage: true,
        });

        await page.close();

        const webPath = `/converted-images/${fileName}.png`;
        console.log(`  ✅ Success: ${webPath}\n`);

        results.push({
          originalPath: relativePath,
          outputPath: webPath,
          status: "success",
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        const errorMessage = String(error);
        console.log(`  ❌ Failed: ${errorMessage}\n`);

        results.push({
          originalPath: relativePath,
          outputPath: "",
          status: "failed",
          error: errorMessage,
          timestamp: new Date().toISOString(),
        });
      }
    }

    await browser.close();

    // Save results to JSON file
    const reportPath = path.join(outputDir, "conversion-report.json");
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          startTime: startTime.toISOString(),
          endTime: new Date().toISOString(),
          totalFiles: pdfFiles.length,
          successCount: results.filter((r) => r.status === "success").length,
          failedCount: results.filter((r) => r.status === "failed").length,
          results,
        },
        null,
        2
      )
    );

    // Print summary
    console.log("═".repeat(50));
    console.log("📊 Conversion Summary");
    console.log("═".repeat(50));
    console.log(`Total files: ${pdfFiles.length}`);
    console.log(
      `✅ Successful: ${results.filter((r) => r.status === "success").length}`
    );
    console.log(
      `❌ Failed: ${results.filter((r) => r.status === "failed").length}`
    );
    console.log(`\n📝 Report saved: ${reportPath}\n`);
  } catch (error) {
    console.error("❌ Batch conversion error:", error);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

batchConvertPDFs();
