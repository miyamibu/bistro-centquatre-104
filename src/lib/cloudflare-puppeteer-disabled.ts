const puppeteer = {
  async launch(): Promise<never> {
    throw new Error("PDF_TO_IMAGE_DISABLED_ON_CLOUDFLARE");
  },
};

export default puppeteer;
