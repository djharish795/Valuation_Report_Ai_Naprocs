import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import * as mammoth from "mammoth";
import * as xlsx from "xlsx";
import WordExtractor from "word-extractor";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 30 * 60 * 1000, // 30 minutes to allow for massive document extraction
});

export async function POST(req: NextRequest) {
  try {
    const { text, pdfUrl, fileName, schema, baseRates, template } = await req.json();

    if (!text && !pdfUrl) {
      return NextResponse.json({ error: "No text or PDF provided" }, { status: 400 });
    }

    // Credit Check
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('credits')
      .eq('id', user.id)
      .single();

    if (!profile || profile.credits < 1) {
      return NextResponse.json({ error: "Insufficient credits. Please upgrade your plan." }, { status: 403 });
    }

    const contentBlocks: any[] = [];
    
    if (pdfUrl) {
      const match = pdfUrl.match(/^data:([^;]+);base64,(.+)$/);
      let mimeType = match ? match[1] : "";
      const base64Data = match ? match[2] : pdfUrl;

      // Use fileName to help determine the type if MIME type is generic, missing, or ZIP-compressed
      const extension = fileName ? fileName.split('.').pop()?.toLowerCase() : '';
      
      if (!mimeType || mimeType === "application/octet-stream" || mimeType === "application/x-zip-compressed") {
        if (extension === "pdf") mimeType = "application/pdf";
        else if (extension === "docx") mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        else if (extension === "doc") mimeType = "application/msword";
        else if (extension === "xlsx") mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        else if (extension === "xls") mimeType = "application/vnd.ms-excel";
        else if (["png", "jpg", "jpeg", "gif", "webp"].includes(extension)) mimeType = `image/${extension === "jpg" ? "jpeg" : extension}`;
      }

      const isPdf = mimeType === "application/pdf" || extension === "pdf";
      const isWord = mimeType.includes("wordprocessingml") || mimeType === "application/msword" || extension === "docx" || extension === "doc";
      const isExcel = mimeType.includes("spreadsheetml") || mimeType === "application/vnd.ms-excel" || extension === "xlsx" || extension === "xls";

      if (isPdf) {
        contentBlocks.push({
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: base64Data,
          },
        });
      } else if (isWord) {
        // Parse Word Doc
        const buffer = Buffer.from(base64Data, "base64");
        try {
          let extractedText = "";
          if (extension === "doc" || mimeType === "application/msword") {
            const extractor = new WordExtractor();
            const doc = await extractor.extract(buffer);
            extractedText = doc.getBody();
          } else {
            // Default to mammoth for docx
            try {
              const result = await mammoth.extractRawText({ buffer });
              extractedText = result.value;
            } catch (mammothErr) {
              // Fallback to word-extractor if mammoth fails on docx
              console.warn("[extract-data] Mammoth failed, trying word-extractor fallback:", mammothErr);
              const extractor = new WordExtractor();
              const doc = await extractor.extract(buffer);
              extractedText = doc.getBody();
            }
          }

          contentBlocks.push({
            type: "text",
            text: `Extracted text from Word Document:\n\n${extractedText}`
          });
        } catch (e) {
          console.error("Error parsing Word doc", e);
          return NextResponse.json({ error: "Failed to parse Word document. Please ensure it is a valid document." }, { status: 400 });
        }
      } else if (isExcel) {
        // Parse Excel
        const buffer = Buffer.from(base64Data, "base64");
        try {
          const workbook = xlsx.read(buffer, { type: "buffer" });
          let excelText = "";
          for (const sheetName of workbook.SheetNames) {
            const worksheet = workbook.Sheets[sheetName];
            excelText += `Sheet: ${sheetName}\n`;
            excelText += xlsx.utils.sheet_to_csv(worksheet) + "\n\n";
          }
          contentBlocks.push({
            type: "text",
            text: `Extracted data from Excel Document:\n\n${excelText}`
          });
        } catch (e) {
           console.error("Error parsing Excel", e);
           return NextResponse.json({ error: "Failed to parse Excel document." }, { status: 400 });
         }
      } else {
        // Fallback or Image, send as image or text? Let's fallback to PDF or Image
        // If it's an image, Anthropic supports image blocks
        if (mimeType.startsWith("image/")) {
           contentBlocks.push({
             type: "image",
             source: {
               type: "base64",
               media_type: mimeType as any,
               data: base64Data,
             }
           });
        } else {
           contentBlocks.push({
             type: "document",
             source: {
               type: "base64",
               media_type: "application/pdf",
               data: base64Data,
             },
           });
        }
      }
    }

    if (text) {
      contentBlocks.push({
        type: "text",
        text: `Extract details from this text: \n\n${text}`
      });
    } else {
      contentBlocks.push({
        type: "text",
        text: "Extract property details from the provided document based on the requirements."
      });
    }

    const coreFields = ["ownerName", "surveyNumber", "propertyAddress", "marketValue", "distressValue"];
    let finalSchema = schema ? [...schema] : [];
    
    // Ensure core fields are present in schema for UI binding
    coreFields.forEach(field => {
      if (schema && !schema.some((f: any) => f.name === field)) {
        finalSchema.push({ 
          name: field, 
          label: field.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()), 
          type: "text" 
        });
      }
    });

    const schemaInstruction = finalSchema.length > 0
      ? `Extract and calculate the following fields: ${JSON.stringify(finalSchema)}`
      : "Extract/Calculate: ownerName, surveyNumber, propertyAddress, propertyType, landValue, buildingValue, yearsAfterConstruction, marketValue, distressValue.";

    const baseRateContext = baseRates 
      ? `CONTEXT: The user has provided the following base rates:
         - Market Rate: ${baseRates.marketRate} per sq unit
         - Government Rate: ${baseRates.governmentRate} per sq unit
         Use these rates to calculate total values (Total Value = Area * Rate) even if not mentioned in the deed.
         If the deed has different values, prioritize the provided base rates for consistent valuation.`
      : "";

    const response = await anthropic.messages.create({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-4-6",
      max_tokens: 64000, // Increased from 8000 to prevent truncation on large deeds
      temperature: 0,
      system: [
        {
          type: "text",
          text: `You are a Senior Financial Valuation Expert and Data Extraction Specialist.
      
      Your Goals:
      1. EXACT DETAIL EXTRACTION: Extract *every single relevant detail* from the provided document (Telugu -> English). Do not summarize or omit any dimensions, boundaries, schedules, clauses, or property specifications. The user needs 100% data replication in the final report.
      2. Perform Automated Financial Math: ${baseRateContext}
      3. Calculate derived values:
         - Land Value = Area * Market Rate.
         - Reconstruction Cost = Standard rate for the property type * Area.
         - Depreciation = (Age / Total Life) * 0.9 * Reconstruction Cost.
         - Final Fair Market Value = Land Value + (Reconstruction Cost - Depreciation).
         - Distress Value = 85% of FMV.
      4. Ensure all fields required by this schema are present: ${schemaInstruction}. Add any additional fields if interesting details are found in the deed.
      
      Output a strict JSON object with all fields and a "reasoning" key explaining your math step-by-step.`,
          cache_control: { type: "ephemeral" }
        }
      ] as any,
      messages: [
        {
          role: "user",
          content: contentBlocks,
        }
      ],
    }, {
      headers: {
        "anthropic-beta": "prompt-caching-2024-07-31"
      }
    });

    if (response.stop_reason === "max_tokens") {
      throw new Error("Claude output was truncated due to token limits. Please try a simpler extraction or increase max_tokens further.");
    }

    const content = response.content[0];
    if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude');
    }
    
    // Robust JSON extraction
    const textResponse = content.text;
    let extractedData = null;

    try {
      // Try to find the largest JSON block
      const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extractedData = JSON.parse(jsonMatch[0]);
      } else {
        // Fallback: try to parse the entire text if no braces found (rare)
        extractedData = JSON.parse(textResponse);
      }
    } catch (e) {
      console.error("Initial JSON parse failed. Response text:", textResponse);
      // Attempt to fix common issues: removing markdown blocks
      try {
        const cleaned = textResponse.replace(/```json\n?|\n?```/g, "").trim();
        extractedData = JSON.parse(cleaned);
      } catch (innerE) {
        throw new Error("Failed to parse extracted data from Claude after cleaning.");
      }
    }

    if (!extractedData) {
      throw new Error("Extracted data is null");
    }

    // Save to Supabase Archive & Deduct Credits
    try {
      if (user) {
        // Calculate exact Anthropic cost (Claude 4.6 Sonnet pricing)
        const usage = response.usage;
        const inputTokens = usage?.input_tokens || 0;
        const outputTokens = usage?.output_tokens || 0;
        const exactCost = (inputTokens * 3.0 / 1000000) + (outputTokens * 15.0 / 1000000);

        // Save report
        await supabase.from('reports').insert({
          user_id: user.id,
          owner_name: extractedData.ownerName || "Unknown Owner",
          location: extractedData.propertyAddress || extractedData.location || "N/A",
          valuation_sum: extractedData.distressValue || extractedData.marketValue || "N/A",
          status: "Verified",
          data: { ...extractedData, _billing: { cost: exactCost, input_tokens: inputTokens, output_tokens: outputTokens } },
          template: template
        });

        // Deduct 1 credit
        await supabase
          .from('profiles')
          .update({ credits: profile.credits - 1 })
          .eq('id', user.id);
      }
    } catch (dbError) {
      console.error("Failed to update credits or save report:", dbError);
    }

    return NextResponse.json(extractedData);
  } catch (error) {
    console.error("Claude extraction error:", error);
    return NextResponse.json({ error: "Failed to extract data" }, { status: 500 });
  }
}
