"use client";

import React, { useState } from "react";
import { Upload, FileText, CheckCircle2, Loader2, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileUploaderProps {
  title: string;
  description: string;
  onUpload: (file: File) => Promise<void>;
  icon?: "pdf" | "image";
  status: "idle" | "uploading" | "completed";
  accept?: string;
}

export default function FileUploader({ title, description, onUpload, icon, status, accept }: FileUploaderProps) {
  const [isOver, setIsOver] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onUpload(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsOver(true); }}
      onDragLeave={() => setIsOver(false)}
      onDrop={handleDrop}
      className={cn(
        "relative glass p-8 rounded-2xl border-2 border-dashed transition-all duration-300 group cursor-pointer",
        isOver ? "border-primary bg-primary/5 scale-[1.02]" : "border-white/20 hover:border-primary/50",
        status === "completed" && "border-green-500/50 bg-green-50/50"
      )}
    >
      <input type="file" accept={accept} className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleFileChange} />
      
      <div className="flex flex-col items-center text-center space-y-4">
        <div className={cn(
          "w-16 h-16 rounded-full flex items-center justify-center transition-transform group-hover:scale-110",
          status === "completed" ? "bg-green-100 text-green-600" : "bg-primary/10 text-primary"
        )}>
          {status === "uploading" ? (
            <Loader2 className="w-8 h-8 animate-spin" />
          ) : status === "completed" ? (
            <CheckCircle2 className="w-8 h-8" />
          ) : icon === "pdf" ? (
            <FileText className="w-8 h-8" />
          ) : (
            <ImageIcon className="w-8 h-8" />
          )}
        </div>
        
        <div className="space-y-1">
          <h4 className="font-bold text-lg">{title}</h4>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>

        {status === "completed" && (
          <div className="text-xs font-semibold uppercase tracking-wider text-green-600 bg-green-100 px-3 py-1 rounded-full">
            Success
          </div>
        )}
      </div>
    </div>
  );
}
