package org.seamless.xml;

import org.xml.sax.ErrorHandler;
import org.xml.sax.InputSource;
import org.xml.sax.SAXParseException;
import org.xml.sax.XMLReader;

import javax.xml.parsers.SAXParserFactory;
import javax.xml.transform.Source;
import javax.xml.validation.Schema;
import java.net.URI;
import java.net.URL;
import java.util.logging.Logger;

public class SAXParser {

    static final Logger log = Logger.getLogger(SAXParser.class.getName());
    public static final URI XML_SCHEMA_NAMESPACE = URI.create("http://www.w3.org/2001/xml.xsd");
    public static final URL XML_SCHEMA_RESOURCE =
            Thread.currentThread().getContextClassLoader().getResource("org/seamless/schemas/xml.xsd");

    private final XMLReader xr;

    public SAXParser() {
        this(null);
    }

    public SAXParser(org.xml.sax.helpers.DefaultHandler handler) {
        xr = create();
        if (handler != null) {
            xr.setContentHandler(handler);
        }
    }

    public void setContentHandler(org.xml.sax.ContentHandler handler) {
        xr.setContentHandler(handler);
    }

    protected XMLReader create() {
        try {
            SAXParserFactory factory = SAXParserFactory.newInstance();
            for (String feature : new String[]{
                    "http://xml.org/sax/features/external-general-entities",
                    "http://xml.org/sax/features/external-parameter-entities",
                    "http://apache.org/xml/features/disallow-doctype-decl"
            }) {
                try {
                    factory.setFeature(feature, false);
                } catch (Exception e) {
                    log.warning("Feature not supported: " + feature + " (" + e.getMessage() + ")");
                }
            }
            try {
                factory.setXIncludeAware(false);
            } catch (UnsupportedOperationException e) {
                log.warning("setXIncludeAware not supported: " + e.getMessage());
            }
            try {
                factory.setNamespaceAware(true);
            } catch (UnsupportedOperationException e) {
                log.warning("setNamespaceAware not supported: " + e.getMessage());
            }
            if (getSchemaSources() != null) {
                factory.setSchema(createSchema(getSchemaSources()));
            }
            XMLReader xmlReader = factory.newSAXParser().getXMLReader();
            xmlReader.setErrorHandler(getErrorHandler());
            return xmlReader;
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    protected Schema createSchema(Source[] sources) throws RuntimeException {
        try {
            javax.xml.validation.SchemaFactory schemaFactory =
                    javax.xml.validation.SchemaFactory.newInstance("http://www.w3.org/2001/XMLSchema");
            schemaFactory.setResourceResolver(new CatalogResourceResolver(new SAXParser$1(this)));
            return schemaFactory.newSchema(sources);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    protected Source[] getSchemaSources() {
        return null;
    }

    protected ErrorHandler getErrorHandler() {
        return new SimpleErrorHandler();
    }

    public class SimpleErrorHandler implements ErrorHandler {
        public void warning(SAXParseException e) {}
        public void error(SAXParseException e) {}
        public void fatalError(SAXParseException e) {}
    }

    public void parse(InputSource inputSource) throws ParserException {
        try {
            xr.parse(inputSource);
        } catch (Exception e) {
            throw new ParserException(e);
        }
    }

    static Logger access$000() {
        return log;
    }
}
