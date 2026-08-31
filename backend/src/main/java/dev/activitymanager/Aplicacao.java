package dev.activitymanager;

import dev.activitymanager.comum.Config;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties(Config.class)
public class Aplicacao {
    public static void main(String[] args) {
        SpringApplication.run(Aplicacao.class, args);
    }
}
