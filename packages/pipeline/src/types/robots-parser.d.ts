declare module "robots-parser" {
  interface Robots {
    isAllowed(url: string, userAgent?: string): boolean | undefined;
    isDisallowed(url: string, userAgent?: string): boolean | undefined;
  }
  function robotsParser(url: string, contents: string): Robots;
  export = robotsParser;
}
